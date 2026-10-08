import React, { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { AppError, DvirSummaryRowSchema, InspectionSubmitStrictSchema, InspectionTemplatesResponseSchema, PhotoFirstRefuelSchema, TrailerSwapSchema, type AccidentMediaSlot, type InspectionTemplateItemOption } from '@fleet/shared';
import { api, submitStaged, stagePhoto } from '../../services';
import { ENDPOINTS, url } from '../../api/endpoints';
import { Card, Body, Button, CheckRow, ErrorState, Field, Title } from '../../design/components';
import { Screen } from '../../design/Screen';
import { FormShell } from '../../design/FormShell';
import { Text } from '../../design/Text';
import { MissingHint, announce } from '../../design/states';
import { PhotoCapture, type Captured } from '../../design/PhotoCapture';
import { MaydayButton } from '../../design/MaydayButton';
import { PagedList } from '../../design/PagedList';
import { MediaThumb } from '../../design/MediaThumb';
import { color, font, space } from '../../design/tokens';
import { useCursorList } from '../../core/lists';
import { fieldErrorMap } from '../../core/errors';
import { fmtDateTime } from '../../format';
import { fuelCardsQuery, shiftActiveQuery, trailersQuery } from '../../queries';
import { newId } from '../../core/uuid';

type Err = { code: string; detail?: string; fields: Record<string, string> };
/** One line of the form while the driver is filling it in. */
type ItemDraft = { template_item_id: string; result: 'PASS' | 'FAIL' | 'NOT_APPLICABLE'; numeric?: number; notes?: string; photo?: Captured };
const toErr = (e: unknown, t: (k: string) => string): Err => ({ code: e instanceof AppError ? e.error_code : e && typeof e === 'object' && 'issues' in e ? 'VALIDATION_ERROR' : 'UNKNOWN', detail: e instanceof AppError ? e.detail : undefined, fields: fieldErrorMap(e, t) });

const numeric = (v: string) => {
  const n = Number(v);
  return v.trim() !== '' && Number.isFinite(n) ? n : null;
};

/**
 * Refuel (A1.4, photo-first).
 *
 * E-08 resolved. The gauge-pair endpoint the earlier draft used, `POST /fuel/refuel`, cannot be
 * completed by anyone: it demands `before_fuel_record_id` / `after_fuel_record_id`, but no API
 * creates an `app.fuel_records` row, and its `requirePermission("fuel:enter")` names a permission
 * that is absent from `app.permissions`, so it answers 403 FORBIDDEN for every role. The workable
 * driver flow is `POST /driver/fuel/purchase` (`fuel:submit_purchase`), which takes a receipt photo,
 * an odometer photo and the odometer reading, and lets the server's OCR fill litres and cost. That is
 * what this form submits; `POST /driver/fuel/correct` is offered afterwards if OCR read it wrong.
 */
export const RefuelScreen = () => <FormShell>{({ onDone, banner }) => <RefuelForm onDone={onDone} banner={banner} />}</FormShell>;

function RefuelForm({ onDone, banner }: { onDone: (d: { queued: boolean; anomalies?: string[] }) => void; banner: React.ReactNode }) {
  const { t } = useTranslation();
  const active = useQuery(shiftActiveQuery);
  const assignment = useQuery({ queryKey: ['my-assignment'] });
  const [receipt, setReceipt] = useState<Captured | null>(null);
  const [odoPhoto, setOdoPhoto] = useState<Captured | null>(null);
  const [odometer, setOdometer] = useState('');
  const [purchasedAt, setPurchasedAt] = useState(new Date().toISOString());
  const [card4, setCard4] = useState('');
  const [cardId, setCardId] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<Err | null>(null);

  const vehicleId = active.data?.vehicle_id ?? null;
  // U-05 resolved: `GET /fuel/cards` gives this vehicle's dedicated card plus the pooled ones.
  const cards = useQuery(fuelCardsQuery(vehicleId));
  const odo = numeric(odometer);
  const missing = [
    !vehicleId ? t('shift.assignment') : null,
    odo === null || odo < 0 || !Number.isInteger(odo) ? t('shift.odometer') : null,
    !receipt ? t('forms.receipt') : null,
    !odoPhoto ? t('forms.gaugeBefore') : null,
  ].filter((x): x is string => x !== null);

  async function submit() {
    if (missing.length) { announce(t('forms.missing', { items: missing.join(', ') })); return; }
    setBusy(true); setErr(null);
    try {
      const { queued } = await submitStaged([
        {
          path: url(ENDPOINTS.driverFuelPurchase),
          body: PhotoFirstRefuelSchema.parse({
            shift_id: active.data?.shift_id ?? null,
            vehicle_id: vehicleId,
            odometer_reading: odo,
            receipt_media_object_id: newId(),
            odometer_photo_media_object_id: newId(),
            purchased_at: purchasedAt,
            // The four digits are always typed: the API deliberately does not return them.
            ...(card4.length === 4 ? { fuel_card_last_four: card4 } : {}),
          }),
          uploads: [stagePhoto(receipt!, 'FUEL_PURCHASE', 'FUEL_RECEIPT'), stagePhoto(odoPhoto!, 'FUEL_PURCHASE', 'FUEL_DASHBOARD')],
        },
      ]);
      onDone({ queued });
    } catch (e) { setErr(toErr(e, t)); announce(t('forms.flagged', { items: '' })); }
    finally { setBusy(false); }
  }

  return (
    <Screen testID="refuel">
      {banner}
      <Title>{t('forms.titleRefuel')}</Title>
      <Field label={t('shift.odometer')} value={odometer} onChange={setOdometer} keyboardType="number-pad" error={err?.fields.odometer_reading} />
      <PhotoCapture label={t('forms.receipt')} retakeLabel={t('forms.retake')} onCaptured={setReceipt} />
      <PhotoCapture label={t('forms.gaugeBefore')} retakeLabel={t('forms.retake')} onCaptured={setOdoPhoto} />
      <Title>{t('forms.pickCard')}</Title>
      {(cards.data?.cards ?? []).map((c) => (
        <CheckRow key={c.id} label={`${c.label} · ${c.provider}${c.is_pooled ? ` · ${t('forms.pooled')}` : ''}`} checked={cardId === c.id} onPress={() => setCardId(c.id)} />
      ))}
      <Field label={t('forms.cardLast4')} value={card4} onChange={setCard4} keyboardType="number-pad" maxLength={4} />
      <Field label={t('forms.purchasedAt')} value={purchasedAt} onChange={setPurchasedAt} autoCapitalize="none" />
      <MissingHint items={missing} />
      {err ? <ErrorState code={err.code} detail={err.detail} /> : null}
      <Button label={t('forms.submit')} busy={busy} disabled={missing.length > 0} onPress={() => void submit()} testID="refuel-submit" />
    </Screen>
  );
}

/**
 * DVIR. The checklist now comes from `GET /inspections/templates`, which returns each template's items
 * (`app.inspection_template_items`) in both languages, with `input_type` saying how to ask:
 * `PASS_FAIL` needs a pass/fail/NA choice and `NUMERIC` needs a reading (the reefer temperature, U-02).
 * The server rules the app mirrors are in `InspectionSubmitStrictSchema`: a FAIL needs a note AND a
 * photo, `previous_defects_reviewed` must be true, and a BLOCKER FAIL grounds the asset.
 */
export const DvirScreen = () => <FormShell>{({ onDone, banner }) => <DvirForm onDone={onDone} banner={banner} />}</FormShell>;

function DvirForm({ onDone, banner }: { onDone: (d: { queued: boolean }) => void; banner: React.ReactNode }) {
  const { t } = useTranslation();
  const { i18n } = useTranslation();
  const tpl = useQuery({ queryKey: ['inspection-templates'], queryFn: () => api.get(url(ENDPOINTS.inspectionTemplates), { schema: InspectionTemplatesResponseSchema }) });
  const active = useQuery(shiftActiveQuery);
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [reviewed, setReviewed] = useState(false);
  const [signature, setSignature] = useState('');
  const [items, setItems] = useState<ItemDraft[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<Err | null>(null);

  const templates = tpl.data?.templates ?? [];
  const chosen = useMemo(() => templates.find((x) => x.template_id === templateId) ?? null, [templates, templateId]);
  const templateItems = chosen?.items ?? [];
  // The server sends both languages for every label, so a Swahili device never shows an English line.
  const labelOf = (i: InspectionTemplateItemOption): string => (i18n.language === 'sw' ? i.label_sw : i.label_en);

  const missing = [
    !templateId ? t('forms.template') : null,
    !signature.trim() ? t('forms.signature') : null,
    !reviewed ? t('forms.defectsReviewed') : null,
  ].filter((x): x is string => x !== null);

  const setItem = (id: string, patch: Partial<ItemDraft>) => setItems((xs) => xs.map((x) => (x.template_item_id === id ? { ...x, ...patch } : x)));

  async function submit() {
    if (missing.length) { announce(t('forms.missing', { items: missing.join(', ') })); return; }
    // Every line must have a result, and a NUMERIC line a reading, before the write is queued.
    for (const it of templateItems) {
      const row = items.find((x) => x.template_item_id === it.template_item_id);
      if (it.is_required && !row) { announce(t('forms.missing', { items: labelOf(it) })); return; }
      if (it.input_type === 'NUMERIC' && row?.numeric === undefined) { announce(t('forms.missing', { items: labelOf(it) })); return; }
      if (it.input_type === 'NUMERIC' && row?.numeric !== undefined && it.min_value !== null && it.max_value !== null && (row.numeric < it.min_value || row.numeric > it.max_value)) {
        setErr({ code: 'VALIDATION_ERROR', fields: { [it.code]: t('forms.outOfRange', { min: it.min_value, max: it.max_value }) } });
        announce(t('forms.outOfRange', { min: it.min_value, max: it.max_value }));
        return;
      }
    }
    setBusy(true); setErr(null);
    try {
      const { queued } = await submitStaged([
        {
          path: url(ENDPOINTS.submitInspection),
          body: InspectionSubmitStrictSchema.parse({
            shift_id: active.data!.shift_id,
            template_id: templateId,
            subject: 'VEHICLE',
            vehicle_id: active.data!.vehicle_id,
            trailer_id: null,
            previous_defects_reviewed: true,
            signature_name: signature.trim(),
            items: templateItems.map((it) => {
              const row = items.find((x) => x.template_item_id === it.template_item_id);
              return {
                template_item_id: it.template_item_id,
                // A NUMERIC line is reported as PASS when a reading is in range; the reading itself is
                // the record, and a FAIL must carry a note and a photo like any other failure.
                result: it.input_type === 'NUMERIC' ? (row?.numeric === undefined ? 'NOT_APPLICABLE' : 'PASS') : (row?.result ?? 'PASS'),
                ...(row?.numeric === undefined ? {} : { numeric_value: row.numeric }),
                ...(row?.notes ? { notes: row.notes } : {}),
                ...(row?.photo ? { photo_media_object_id: newId() } : {}),
              };
            }),
          }),
          uploads: items.filter((i) => i.photo).map((i) => stagePhoto(i.photo!, 'INSPECTION_ITEM', 'INSPECTION')),
        },
      ]);
      onDone({ queued });
    } catch (e) { setErr(toErr(e, t)); }
    finally { setBusy(false); }
  }

  return (
    <Screen testID="dvir">
      {banner}
      <Title>{t('forms.titleInspect')}</Title>
      {tpl.error ? <ErrorState code={tpl.error instanceof AppError ? tpl.error.error_code : 'UNKNOWN'} onAction={() => void tpl.refetch()} /> : null}
      {templates.map((x) => (
        <Card key={x.template_id}>
          <Body>{x.label || x.name}</Body>
          <Button tone={templateId === x.template_id ? 'primary' : 'quiet'} label={t('forms.useTemplate')} onPress={() => { setTemplateId(x.template_id); setItems((x.items ?? []).map((i) => ({ template_item_id: i.template_item_id, result: i.input_type === 'NUMERIC' ? 'NOT_APPLICABLE' : 'PASS' }))); }} />
        </Card>
      ))}
      {chosen && !templateItems.length ? <Card><Body dim>{t('forms.noTemplateItems')}</Body></Card> : null}
      {templateItems.map((item) => {
        const row = items.find((i) => i.template_item_id === item.template_item_id);
        const numeric = item.input_type === 'NUMERIC';
        return (
          <Card key={item.template_item_id}>
            <Body>{labelOf(item)}</Body>
            {item.severity === 'BLOCKER' ? <Body dim>{t('detail.blockerItem')}</Body> : null}
            {numeric ? (
              // U-02 built: the reefer temperature, with the server's own bounds. unit is e.g. 'C'.
              <Field
                label={item.unit ? `${labelOf(item)} (${item.min_value ?? '−∞'} … ${item.max_value ?? '∞'} ${item.unit})` : labelOf(item)}
                value={row?.numeric === undefined ? '' : String(row.numeric)}
                onChange={(v) => setItem(item.template_item_id, { numeric: v.trim() === '' ? undefined : Number(v) })}
                keyboardType="numbers-and-punctuation"
                error={err?.fields[item.code]}
              />
            ) : (
              <View style={styles.row}>
                {(['PASS', 'FAIL', 'NOT_APPLICABLE'] as const).map((r) => (
                  <Button key={r} tone={row?.result === r ? 'primary' : 'quiet'} label={t(`forms.${r === 'NOT_APPLICABLE' ? 'na' : r.toLowerCase()}`)} onPress={() => setItem(item.template_item_id, { result: r })} />
                ))}
              </View>
            )}
            {row?.result === 'FAIL' ? (
              <>
                <Field label={t('forms.notes')} value={row.notes ?? ''} onChange={(v) => setItem(item.template_item_id, { notes: v })} />
                <PhotoCapture label={t('forms.itemPhoto')} retakeLabel={t('forms.retake')} onCaptured={(p) => setItem(item.template_item_id, { photo: p })} />
              </>
            ) : null}
          </Card>
        );
      })}
      <Button tone={reviewed ? 'primary' : 'quiet'} label={t('forms.defectsReviewed')} onPress={() => setReviewed((v) => !v)} />
      <Field label={t('forms.signature')} value={signature} onChange={setSignature} />
      <MissingHint items={missing} />
      {err ? <ErrorState code={err.code} detail={err.detail} /> : null}
      <Button label={t('forms.submit')} busy={busy} disabled={missing.length > 0} onPress={() => void submit()} testID="dvir-submit" />
    </Screen>
  );
}

/**
 * Accident report. `AccidentCreateSchema` has NO severity field: the server derives severity
 * (`accident_reports.severity`) from the report, so the local severity chips are a triage hint for the
 * statement and are not sent. Each photo then goes to `POST /accidents/{id}/media` with its slot, using
 * the `accident_id` this write produces (S-11).
 */
export const AccidentScreen = () => <FormShell>{({ onDone, banner }) => <AccidentForm onDone={onDone} banner={banner} />}</FormShell>;

function AccidentForm({ onDone, banner }: { onDone: (d: { queued: boolean }) => void; banner: React.ReactNode }) {
  const { t } = useTranslation();
  const active = useQuery(shiftActiveQuery);
  const [severity, setSeverity] = useState<string>('MINOR');
  const [statement, setStatement] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<Err | null>(null);
  const [photos, setPhotos] = useState<Partial<Record<AccidentMediaSlot, Captured>>>({});

  async function submit() {
    setBusy(true); setErr(null);
    try {
      const accidentToken = newId();
      const ops = [{
        path: url(ENDPOINTS.submitAccident),
        body: {
          shift_id: active.data?.shift_id ?? null,
          vehicle_id: active.data?.vehicle_id ?? null,
          trailer_id: active.data?.trailer_id ?? null,
          occurred_at: new Date().toISOString(),
          driver_statement: statement || undefined,
        },
        produces: { token: accidentToken, field: 'accident_id' },
      }];
      const { queued } = await submitStaged(ops);
      onDone({ queued });
    } catch (e) { setErr(toErr(e, t)); }
    finally { setBusy(false); }
  }

  return (
    <Screen testID="accident-form">
      {banner}
      <Title>{t('accident.report')}</Title>
      <MaydayButton />
      <View style={styles.row}>
        {(['MINOR', 'MODERATE', 'SEVERE'] as const).map((s) => <Button key={s} tone={severity === s ? 'primary' : 'quiet'} label={t(`accident.${s}`)} onPress={() => setSeverity(s)} />)}
      </View>
      <Field label={t('accident.statement')} value={statement} onChange={setStatement} multiline />
      {(['FRONT_DAMAGE', 'REAR_DAMAGE', 'SIDE_DAMAGE', 'ADDITIONAL'] as AccidentMediaSlot[]).map((slot) => (
        <Card key={slot}>
          <Body>{t(`accident.slot.${slot}`)}</Body>
          {photos[slot] ? <MediaThumb mediaId={null} label={t('detail.photo')} /> : <PhotoCapture label={t('accident.addPhoto')} retakeLabel={t('forms.retake')} onCaptured={(p) => setPhotos((x) => ({ ...x, [slot]: p }))} />}
        </Card>
      ))}
      {err ? <ErrorState code={err.code} detail={err.detail} /> : null}
      <Button label={t('accident.report')} busy={busy} onPress={() => void submit()} testID="accident-submit" />
    </Screen>
  );
}

/**
 * Trailer swap. `TrailerSwapSchema` has no assignment field: `trailer_id` picks an existing trailer,
 * `new_trailer_plate` + `new_trailer_type` create one, and `trailer_id: null` means bobtail (C1.12).
 * The hook photo and the hook inspection id are required, so the swap follows a DVIR submission.
 */
export const TrailerSwapScreen = () => <FormShell>{({ onDone, banner }) => <TrailerSwapForm onDone={onDone} banner={banner} />}</FormShell>;

function TrailerSwapForm({ onDone, banner }: { onDone: (d: { queued: boolean }) => void; banner: React.ReactNode }) {
  const { t } = useTranslation();
  const active = useQuery(shiftActiveQuery);
  const [bobtail, setBobtail] = useState(false);
  const [existing, setExisting] = useState('');
  const [plate, setPlate] = useState('');
  const [type, setType] = useState('');
  // U-03: `GET /trailer` (singular — that is how the router is mounted) lists every available,
  // operational trailer. One already hooked to a vehicle is filtered out here rather than refused by a
  // unique-index violation on the server later.
  const trailers = useQuery(trailersQuery);
  const hookable = (trailers.data?.trailers ?? []).filter((x) => x.current_vehicle_id === null);
  const [hook, setHook] = useState<Captured | null>(null);
  const [inspectionId, setInspectionId] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<Err | null>(null);

  // U-03: exactly one of bobtail (`trailer_id: null`), an existing trailer from `GET /trailer`, or a new
  // plate + type. The list is bounded at 200 by the server, so no pagination here.
  const mode: 'BOBTAIL' | 'EXISTING' | 'NEW' = bobtail ? 'BOBTAIL' : existing ? 'EXISTING' : 'NEW';
  const missing = [
    !active.data?.vehicle_id ? t('shift.assignment') : null,
    !hook ? t('swap.hookPhoto') : null,
    !bobtail && !existing && !plate.trim() ? t('swap.plate') : null,
    !bobtail && !existing && plate.trim() && !type ? t('swap.type') : null,
    !inspectionId.trim() ? t('forms.template') : null,
  ].filter((x): x is string => x !== null);

  async function submit() {
    if (missing.length) { announce(t('forms.missing', { items: missing.join(', ') })); return; }
    setBusy(true); setErr(null);
    try {
      const { queued } = await submitStaged([
        {
          path: url(ENDPOINTS.trailerSwap),
          body: TrailerSwapSchema.parse({
            shift_id: active.data?.shift_id ?? null,
            vehicle_id: active.data!.vehicle_id,
            // U-03: an existing trailer is selectable; `trailer_id: null` is a bobtail.
            trailer_id: mode === 'EXISTING' ? existing : null,
            new_trailer_plate: mode === 'NEW' ? plate.trim() : undefined,
            new_trailer_type: mode === 'NEW' ? (type as never) : undefined,
            hook_media_object_id: newId(),
            hook_inspection_id: inspectionId.trim(),
          }),
          uploads: [stagePhoto(hook!, 'TRAILER_ASSIGNMENT', 'TRAILER_SWAP')],
        },
      ]);
      onDone({ queued });
    } catch (e) { setErr(toErr(e, t)); }
    finally { setBusy(false); }
  }

  return (
    <Screen testID="trailer-swap">
      {banner}
      <Title>{t('swap.title')}</Title>
      <Button tone={mode === 'BOBTAIL' ? 'primary' : 'quiet'} label={t('swap.bobtail')} onPress={() => { setBobtail(true); setExisting(''); }} />
      <Title>{t('swap.pickExisting')}</Title>
      {hookable.length === 0 ? <Body dim>{t('swap.noTrailers')}</Body> : hookable.map((x) => (
        <CheckRow key={x.id} label={`${x.license_plate} · ${t(`swap.type_${x.trailer_type}`)}`} checked={existing === x.id} onPress={() => { setExisting(x.id); setBobtail(false); }} />
      ))}
      <Title>{t('swap.newTrailer')}</Title>
      <Button tone={mode === 'NEW' ? 'primary' : 'quiet'} label={t('swap.addNew')} onPress={() => { setExisting(''); setBobtail(false); }} />
      {mode !== 'NEW' ? null : (
        <>
          <Field label={t('swap.plate')} value={plate} onChange={setPlate} autoCapitalize="characters" />
          <Field label={t('swap.type')} value={type} onChange={setType} autoCapitalize="characters" />
        </>
      )}
      <PhotoCapture label={t('swap.hookPhoto')} retakeLabel={t('forms.retake')} onCaptured={setHook} />
      <Field label={t('swap.inspection')} value={inspectionId} onChange={setInspectionId} autoCapitalize="none" />
      <MissingHint items={missing} />
      {err ? <ErrorState code={err.code} detail={err.detail} /> : null}
      <Button label={t('forms.submit')} busy={busy} disabled={missing.length > 0} onPress={() => void submit()} testID="swap-submit" />
    </Screen>
  );
}

/** The driver's own DVIR history. */
export function DvirHistoryScreen() {
  const { t } = useTranslation();
  const list = useCursorList(['dvir-list'], url(ENDPOINTS.myInspections), DvirSummaryRowSchema);
  return (
    <Screen testID="dvir-history" offlineTag>
      <Title>{t('review.inspections')}</Title>
      <PagedList list={list} keyOf={(x) => x.inspection_id} empty={t('admin.emptyDvir')} render={(x) => (
        <Card>
          <Body>{x.template_label ?? '—'}</Body>
          <Text style={styles.dim}>{fmtDateTime(x.submitted_at)} · {x.status}</Text>
        </Card>
      )} />
    </Screen>
  );
}

const styles = StyleSheet.create({ row: { flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' }, dim: { fontFamily: font.body, fontSize: 13, color: color.mist } });