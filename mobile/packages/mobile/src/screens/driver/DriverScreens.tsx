import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { AppError, DriverAssignmentSchema } from '@fleet/shared';
import { api, submitStaged } from '../../services';
import { ENDPOINTS, url } from '../../api/endpoints';
import { stagePhoto } from '../../services';
import { Card, StatusBadge, Body, Button, ErrorState, Field, Title } from '../../design/components';
import { BackgroundImage } from '../../design/BackgroundImage';
import { GaugePicker } from '../../design/GaugePicker';
import { Screen } from '../../design/Screen';
import { Text } from '../../design/Text';
import { MissingHint, announce } from '../../design/states';
import { PhotoCapture, type Captured } from '../../design/PhotoCapture';
import { MaydayButton } from '../../design/MaydayButton';
import { bgImage } from '../../design/branding';
import { space } from '../../design/tokens';
import { queryClient } from '../../services';
import { useUi } from '../../state/store';
import { lastOdometerQuery, myOnboardingQuery, shiftActiveQuery, vehicleStatesQuery } from '../../queries';
import { flushOnStop, startPhoneTracking, stopPhoneTracking } from '../../core/phoneTracking';
import { goto } from '../../navigation/ref';
import { fmtDateTime } from '../../format';
import { newId } from '../../core/uuid';
import type { FuelGaugeLevel } from '@fleet/shared';

const clockInQuery = {
  queryKey: ['clock-in', 'consentVersion'],
  queryFn: async () => {
    const { consentSatisfied } = await import('../../services');
    return consentSatisfied();
  },
  staleTime: 60_000,
};

/**
 * E-10 resolved: there is no "list of assignments" endpoint. `GET /drivers/me/assignment` returns
 * the driver's CURRENT assignment as a single object and 404 `NO_ASSIGNMENT` when there is none, so
 * the picker that used to guess an assignment id is gone and clock-in sends the assignment the server
 * already knows about.
 */
export const myAssignmentQuery = {
  queryKey: ['my-assignment'],
  queryFn: async () => {
    try {
      return await api.get<ReturnType<typeof DriverAssignmentSchema.parse>>(url(ENDPOINTS.myAssignment), { schema: DriverAssignmentSchema });
    } catch (e) {
      // 404 NO_ASSIGNMENT is a state, not a failure: an unassigned driver must not see an error card.
      if (e instanceof AppError && e.error_code === 'NO_ASSIGNMENT') return null;
      throw e;
    }
  },
  staleTime: 60_000,
};

/** HOS rest-end: the server computes it (`next_eligible_clock_in_at` on the driver-scoped map row). */
const restUntil = (rows: { next_eligible_clock_in_at: string | null }[] | undefined): string | null => {
  const at = rows?.map((r) => r.next_eligible_clock_in_at).find((v): v is string => !!v);
  return at ?? null;
};

export function HomeScreen() {
  const { t } = useTranslation();
  const online = useUi((s) => s.online);
  // U-06 resolved: `GET /drivers/me/onboarding` is the only driver-readable source of a name.
  const profile = useQuery(myOnboardingQuery);
  const shift = useQuery(vehicleStatesQuery);
  const active = useQuery(shiftActiveQuery);
  const vehicleStates = shift.data?.vehicles ?? [];
  const me = vehicleStates[0];
  const assignments = useQuery(myAssignmentQuery);

  return (
    <BackgroundImage source={bgImage.driver}>
      <Screen offlineTag testID="home">
        <Title>{profile.data?.full_name ? `${t('nav.home')} · ${profile.data.full_name}` : t('nav.home')}</Title>
        <MaydayButton />
        {active.data ? (
          <Card>
            <Body>{t('shift.onDuty', { time: fmtDateTime(active.data.clock_in_at) })}</Body>
            <Body dim>{t('shift.vehicle', { plate: me?.plate ?? '—' })}</Body>
            <Button label={t('shift.clockOut')} onPress={() => goto('ClockOut')} testID="home-clockout" />
          </Card>
        ) : (
          <Card>
            <Body>{t('shift.noShift')}</Body>
            {assignments.data === null ? <Body dim>{t('shift.noAssignmentHint')}</Body> : null}
            {me?.display_state ? <StatusBadge state={me.display_state} /> : null}
            <Button label={t('shift.clockIn')} onPress={() => goto('ClockIn')} testID="home-clockin" />
          </Card>
        )}
        {!online ? null : restUntil(vehicleStates) ? (
          <Card><Body>{t('shift.restUntil', { time: fmtDateTime(restUntil(vehicleStates)!) })}</Body></Card>
        ) : null}
        <Card>
          <Button tone="quiet" label={t('swap.title')} onPress={() => goto('TrailerSwap')} />
          <Button tone="quiet" label={t('vehicle.title')} onPress={() => goto('MyVehicle')} />
        </Card>
      </Screen>
    </BackgroundImage>
  );
}

/**
 * Clock-in. The real request (`ClockInSchema`) needs an assignment id, a whole-km odometer, the fuel
 * gauge the driver actually reads, a media object id, the consent version, and whether the phone-GPS
 * fallback is on. `phone_gps_fallback_enabled` is a server-side flag that affects rest calculation
 * (C5.7), so it defaults from the stored consent rather than being invented per shift.
 */
export function ClockInScreen() {
  const { t } = useTranslation();
  const [odometer, setOdometer] = useState('');
  const [gauge, setGauge] = useState<FuelGaugeLevel | null>(null);
  const [photo, setPhoto] = useState<Captured | null>(null);
  const [planNotes, setPlanNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [phoneFallback, setPhoneFallback] = useState(false);
  /** The server returns `disclaimer` on a successful clock-in; it is shown verbatim, not paraphrased. */
  const [disclaimer, setDisclaimer] = useState<string | null>(null);
  const [err, setErr] = useState<{ code: string; detail?: string } | null>(null);
  const consentOk = useQuery(clockInQuery);
  const assignment = useQuery(myAssignmentQuery);
  // The active shift carries the vehicle once the driver is on duty; before clock-in the assignment does.
  const active = useQuery(shiftActiveQuery);
  const { data: consentVersion } = useQuery({
    queryKey: ['consent-version'],
    queryFn: async () => (await import('../../services')).consentStatus(),
    select: (s) => s.required_version,
  });

  /**
   * E-13 / U-04 resolved: `GET /vehicles/{id}` returns `current_odometer_km`, the vehicle's last
   * ACCEPTED reading (E-13 previously assumed nothing exposed it). So the driver is told a decrease or
   * a large jump BEFORE the round trip, instead of only learning about it from ODOMETER_DECREASED.
   * U-04 was to use it; it does.
   */
  const vehicleId = active.data?.vehicle_id ?? assignment.data?.vehicle_id ?? null;
  const last = useQuery(lastOdometerQuery(vehicleId));
  const odo = Number(odometer);
  const lastKm = last.data?.current_odometer_km ?? null;
  const odoError =
    odometer && (!Number.isInteger(odo) || odo < 0)
      ? t('forms.wholeNumber')
      : lastKm !== null && odo > 0 && odo < lastKm
        ? t('forms.odometerLower', { last: lastKm })
        : lastKm !== null && odo - lastKm > 500
          ? t('forms.odometerJump', { km: odo - lastKm })
          : undefined;
  const missing = [
    !assignment.data ? t('shift.assignment') : null,
    !Number.isInteger(odo) || odo < 0 ? t('shift.odometer') : null,
    odoError ?? null,
    !gauge ? t('gauge.label') : null,
    !photo ? t('shift.photo') : null,
    !consentOk.data ? t('auth.consentTitle') : null,
  ].filter((x): x is string => x !== null);

  async function submit() {
    if (missing.length) { announce(t('forms.missing', { items: missing.join(', ') })); return; }
    setBusy(true); setErr(null);
    const token = newId();
    // Start the sampler BEFORE the shift is written, so the flag and the behaviour cannot disagree.
    const trackingStarted = phoneFallback ? await startPhoneTracking() : false;
    setPhoneFallback(trackingStarted);
    if (phoneFallback && !trackingStarted) setErr({ code: 'UPLOAD_UNAVAILABLE', detail: 'location' });
    try {
      const { queued } = await submitStaged([
        {
          path: url(ENDPOINTS.clockIn),
          body: {
            assignment_id: assignment.data!.assignment_id,
            start_odometer_km: odo,
            start_fuel_gauge: gauge,
            start_media_object_id: token,
            // U-01: TRUE only when the sampler actually started, so the server's rest arithmetic can
            // never assume tracking that is not running. Stays false when permission is refused or GPS
            // is unavailable, which is the honest answer.
            phone_gps_fallback_enabled: trackingStarted,
            consent_version: consentVersion ?? 'unknown',
            // E-11: the work plan the schema accepts. Optional, and the office can require it later
            // (WORK_PLAN_REQUIRED) without a client change, because the server owns that decision.
            ...(planNotes.trim() ? { planned_notes: planNotes.trim() } : {}),
          },
          uploads: [stagePhoto(photo!, 'WORK_LOG', 'WORK_PLAN')],
        },
      ]);
      if (!trackingStarted) await stopPhoneTracking();
      void queryClient.invalidateQueries({ queryKey: ['shift-active'] });
      // E-11: the server's own words, shown before navigating away, so nothing is dropped.
      const d = (await (await import('../../services')).lastSubmitResponse()) as { disclaimer?: string | null } | undefined;
      if (d?.disclaimer) { setDisclaimer(d.disclaimer); return; }
      goto('Home');
      if (queued) announce(t('forms.queued'));
    } catch (e) {
      setErr(e instanceof AppError ? { code: e.error_code, detail: e.detail } : { code: 'VALIDATION_ERROR' });
    } finally { setBusy(false); }
  }

  if (disclaimer) {
    return (
      <Screen testID="clock-in-disclaimer">
        <Title>{t('shift.clockedIn')}</Title>
        <Card><Body>{disclaimer}</Body></Card>
        <Button label={t('actions.CONTINUE')} onPress={() => { setDisclaimer(null); goto('Home'); }} testID="clockin-disclaimer-ok" />
      </Screen>
    );
  }

  return (
    <Screen testID="clock-in">
      <Title>{t('shift.clockIn')}</Title>
      <Field label={lastKm !== null ? `${t('shift.odometer')} (${t('forms.lastReading', { km: lastKm })})` : t('shift.odometer')} value={odometer} onChange={setOdometer} keyboardType="number-pad" error={odoError} testID="clockin-odometer" />
      <GaugePicker label={t('gauge.label')} value={gauge} onChange={setGauge} />
      <PhotoCapture label={t('shift.photo')} retakeLabel={t('shift.retakePhoto')} onCaptured={setPhoto} />
      <Field label={t('shift.workPlan')} value={planNotes} onChange={setPlanNotes} multiline />
      {/* U-01: offered, not assumed, and the copy says the app must be open because it must be. */}
      <Button tone={phoneFallback ? 'primary' : 'quiet'} label={t('shift.phoneFallback')} onPress={() => setPhoneFallback((v) => !v)} testID="clockin-phone-fallback" />
      {phoneFallback ? <Body dim>{t('shift.phoneFallbackHelp')}</Body> : null}
      <MissingHint items={missing} />
      {assignment.data ? null : __DEV__ ? <Field label={t('shift.assignment')} value="" onChange={() => {}} editable={false} /> : null}
      {err ? <ErrorState code={err.code} detail={err.detail} /> : null}
      <Button label={t('shift.clockIn')} busy={busy} disabled={missing.length > 0} onPress={() => void submit()} testID="clockin-submit" />
    </Screen>
  );
}

/** Clock-out. `ClockOutSchema`: shift id, end odometer, the gauge the driver reads, and a photo. */
export function ClockOutScreen() {
  const { t } = useTranslation();
  const [odometer, setOdometer] = useState('');
  const [gauge, setGauge] = useState<FuelGaugeLevel | null>(null);
  const [photo, setPhoto] = useState<Captured | null>(null);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<{ code: string; detail?: string } | null>(null);
  const active = useQuery(shiftActiveQuery);
  const last = useQuery(lastOdometerQuery(active.data?.vehicle_id));
  const odo = Number(odometer);
  const lastKm = last.data?.current_odometer_km ?? null;
  const odoError =
    odometer && (!Number.isInteger(odo) || odo < 0)
      ? t('forms.wholeNumber')
      : lastKm !== null && odo > 0 && odo < lastKm
        ? t('forms.odometerLower', { last: lastKm })
        : undefined;

  const missing = [
    !active.data ? t('shift.noShift') : null,
    !Number.isInteger(odo) || odo < 0 ? t('shift.odometer') : null,
    odoError ?? null,
    !gauge ? t('gauge.label') : null,
    !photo ? t('shift.photo') : null,
  ].filter((x): x is string => x !== null);

  async function submit() {
    if (missing.length) { announce(t('forms.missing', { items: missing.join(', ') })); return; }
    setBusy(true); setErr(null);
    const token = newId();
    // A position still in the buffer at clock-out is data that cannot be retaken, so flush before stopping.
    void flushOnStop();
    try {
      const { queued } = await submitStaged([
        {
          path: url(ENDPOINTS.clockOut),
          body: { shift_id: active.data!.shift_id, end_odometer_km: odo, end_fuel_gauge: gauge, end_media_object_id: token, debrief_notes: notes || undefined },
          uploads: [stagePhoto(photo!, 'WORK_LOG', 'WORK_PLAN')],
        },
      ]);
      void queryClient.invalidateQueries({ queryKey: ['shift-active'] });
      goto('Home');
      if (queued) announce(t('forms.queued'));
    } catch (e) {
      setErr(e instanceof AppError ? { code: e.error_code, detail: e.detail } : { code: 'VALIDATION_ERROR' });
    } finally { setBusy(false); }
  }

  return (
    <Screen testID="clock-out">
      <Title>{t('shift.clockOut')}</Title>
      <Field label={lastKm !== null ? `${t('shift.odometer')} (${t('forms.lastReading', { km: lastKm })})` : t('shift.odometer')} value={odometer} onChange={setOdometer} keyboardType="number-pad" error={odoError} />
      <GaugePicker label={t('gauge.label')} value={gauge} onChange={setGauge} />
      <PhotoCapture label={t('shift.photo')} retakeLabel={t('shift.retakePhoto')} onCaptured={setPhoto} />
      <Field label={t('shift.notes')} value={notes} onChange={setNotes} multiline />
      <MissingHint items={missing} />
      {err ? <ErrorState code={err.code} detail={err.detail} /> : null}
      <Button label={t('shift.clockOut')} busy={busy} disabled={missing.length > 0} onPress={() => void submit()} testID="clockout-submit" />
    </Screen>
  );
}

/** The outbox. Retry, edit (new idempotency key) or discard every queued write. */
export function OutboxScreen() {
  const { t } = useTranslation();
  const [tick, setTick] = useState(0);
  const rows = useQuery({ queryKey: ['outbox', tick], queryFn: async () => (await (await import('../../services')).getQueue()).outbox(), refetchInterval: 5000 });

  async function retry(id: number) { await (await (await import('../../services')).getQueue()).retry(id); setTick((n) => n + 1); }
  async function discard(id: number) { await (await (await import('../../services')).getQueue()).discard(id); setTick((n) => n + 1); }

  return (
    <Screen testID="outbox">
      <Title>{t('outbox.title')}</Title>
      <Text style={styles.count}>{rows.data?.length ?? 0}</Text>
      {rows.data?.map((w) => (
        <Card key={w.id}>
          <Body>{w.path}</Body>
          <Body dim>{w.status}{w.error_code ? ` · ${w.error_code}` : ''}</Body>
          <View style={styles.row}>
            {w.status === 'FAILED_REVIEW' ? <Button tone="quiet" label={t('outbox.edit')} onPress={() => goto('EditQueued', { id: w.id })} /> : null}
            <Button tone="quiet" label={t('outbox.retry')} onPress={() => void retry(w.id)} />
            <Button tone="quiet" label={t('outbox.discard')} onPress={() => void discard(w.id)} />
          </View>
        </Card>
      ))}
      <Button label={t('outbox.flush')} onPress={() => { void (async () => { const { drainScheduler, refreshOutboxCount } = await import('../../services'); await drainScheduler.kick(); await refreshOutboxCount(); setTick((n) => n + 1); })(); }} />
    </Screen>
  );
}

const styles = StyleSheet.create({ count: { fontSize: 20, marginBottom: space.sm }, row: { flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' } });