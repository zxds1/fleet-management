import React, { useState, useEffect, useRef } from 'react';
import { StyleSheet, View, Pressable } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useTranslation } from 'react-i18next';
import { ENDPOINTS, url } from '../../api/endpoints';
import { api } from '../../services';
import { z } from 'zod';
import { HardwarePairSchema } from '@fleet/shared';
import { Body, Button, Card, ErrorState, Field, Title } from '../../design/components';
import { Screen } from '../../design/Screen';
import { Text as HelixText } from '../../design/Text';
import { color, space } from '../../design/tokens';
import { useCan } from '../../state/store';

export function TrackerPairScreen({ navigation }: any) {
  const { t } = useTranslation();
  const canPair = useCan('asset:update');
  const [imei, setImei] = useState('');
  const [brand, setBrand] = useState('');
  const [sim, setSim] = useState('');
  const [vehicleId, setVehicleId] = useState('');
  const [vehicles, setVehicles] = useState<{ id: string; license_plate: string }[]>([]);
  const [selectedVehicle, setSelectedVehicle] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(true);
  const [permission, requestPermission] = useCameraPermissions();
  const scanned = useRef(false);

  useEffect(() => {
    if (!canPair) return;
    api.get(url(ENDPOINTS.vehicles), { schema: z.array(z.object({ id: z.string(), license_plate: z.string() })) }).then((list) => setVehicles(list)).catch(() => {});
  }, [canPair]);

  async function onScanned(data: { data: string }) {
    if (scanned.current) return;
    scanned.current = true;
    const raw = data.data.trim();
    const imeiMatch = raw.match(/\d{15}/);
    if (imeiMatch) setImei(imeiMatch[0]);
    setScanning(false);
  }

  async function submit() {
    setErr(null); setMsg(null); setBusy(true);
    try {
      const body = HardwarePairSchema.parse({ trackerImei: imei, trackerBrand: brand || 'GENERIC_H02', trackerSimNumber: sim || undefined, vehicleId: selectedVehicle ?? '' });
      await api.post(url(ENDPOINTS.hardwarePair), { body });
      setMsg(t('hardware.paired'));
      navigation.goBack();
    } catch (e) { setErr(e instanceof Error ? e.message : 'UNKNOWN'); } finally { setBusy(false); }
  }

  if (!canPair) {
    return (
      <Screen>
        <Body dim>{t('settings.readOnly')}</Body>
      </Screen>
    );
  }

  return (
    <Screen>
      <Title>{t('hardware.title')}</Title>
      {msg ? <Card><Body>{msg}</Body></Card> : null}
      {err ? <ErrorState code={err} /> : null}

      <Card>
        <Body>{t('hardware.scanQr')}</Body>
        {scanning && permission?.granted ? (
          <View style={styles.camera}>
            <CameraView onBarcodeScanned={onScanned} barcodeScannerSettings={{ barcodeTypes: ['qr'] }} style={StyleSheet.absoluteFill} />
            <View style={styles.scanOverlay}><HelixText style={styles.scanText}>{t('hardware.scanning')}</HelixText></View>
          </View>
        ) : (
          <View style={styles.cameraOff}>
            <Body dim>{t('hardware.scanHint')}</Body>
            {!permission?.granted && <Button tone="quiet" label={t('hardware.enableCamera')} onPress={requestPermission} />}
          </View>
        )}
        <Button tone="quiet" label={scanning ? t('hardware.enterManually') : t('hardware.scanAgain')} onPress={() => { setScanning((v) => !v); scanned.current = false; }} />
      </Card>

      <Card>
        <Field label={t('hardware.imei')} value={imei} onChangeText={setImei} autoCapitalize="none" maxLength={15} keyboardType="number-pad" />
        <Field label={t('hardware.brand')} value={brand} onChangeText={setBrand} autoCapitalize="none" />
        <Field label={t('hardware.sim')} value={sim} onChangeText={setSim} autoCapitalize="none" />
        <Body>{t('hardware.vehicle')}</Body>
        <View style={{ gap: space.xs }}>
          {vehicles.map((v) => (
            <Pressable key={v.id} onPress={() => setSelectedVehicle(v.id)} style={{ padding: space.sm, borderRadius: 8, borderWidth: 2, borderColor: selectedVehicle === v.id ? color.verge : color.line, backgroundColor: selectedVehicle === v.id ? color.paper : color.dust }}>
              <Body style={{ fontWeight: selectedVehicle === v.id ? '600' : '400' }}>{v.license_plate}</Body>
            </Pressable>
          ))}
        </View>
        {!selectedVehicle ? <Body dim>{t('hardware.pickVehicle')}</Body> : null}
        <Button label={t('hardware.pair')} onPress={() => void submit()} busy={busy} disabled={!imei.trim() || imei.length !== 15 || !selectedVehicle} />
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  camera: { height: 240, borderRadius: 12, overflow: 'hidden', backgroundColor: '#000' },
  cameraOff: { height: 120, borderRadius: 12, backgroundColor: color.mist, alignItems: 'center', justifyContent: 'center' },
  scanOverlay: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.3)' },
  scanText: { color: color.paper, fontFamily: 'PublicSans_600SemiBold', fontSize: 16 },
});
