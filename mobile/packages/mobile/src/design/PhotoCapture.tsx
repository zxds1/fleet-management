import React, { useRef, useState } from 'react';
import { MEDIA_MAX_WIDTH_PX } from '../core/policy';
import { View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { SaveFormat, manipulateAsync } from 'expo-image-manipulator';
import { File } from 'expo-file-system';
import { useTranslation } from 'react-i18next';
import { Button } from './components';
import { ErrorState } from './components';
import { space, radius } from './tokens';
import { compressToLimit } from '../core/compress';

export type Captured = { uri: string; width: number; height: number };
// Photo width comes from the one policy source (B-07).
const MAX_WIDTH = MEDIA_MAX_WIDTH_PX;

/**
 * Captures one JPEG. Photos are resized to the policy width and re-encoded until they are under the
 * 500 KB upload budget BEFORE they are queued, so a driver on a weak connection never uploads a 4 MB
 * camera original.
 *
 * There is no video mode (B-07, decided): a 15 s clip cannot fit inside a 500 KB budget, so the control
 * was removed rather than shown and then guaranteed to fail at upload time. Every capture site is a
 * photo — an odometer, a fuel gauge, a receipt, a damage photo or a defect photo — and all of them are
 * legible at 1080 px, so the budget costs nothing real. If video is ever wanted back it needs a second
 * policy value and a real compression budget, not a raised photo budget.
 */
export function PhotoCapture({ label, retakeLabel, onCaptured }: { label: string; retakeLabel: string; onCaptured: (p: Captured) => void }) {
  const { t } = useTranslation(); const [perm, ask] = useCameraPermissions(); const ref = useRef<CameraView>(null);
  const [open, setOpen] = useState(false); const [taken, setTaken] = useState(false); const [busy, setBusy] = useState(false); const [tooBig, setTooBig] = useState(false);
  if (!perm?.granted) return <Button tone="quiet" label={label} onPress={() => void ask()} />;
  if (!open) return <View style={{ gap: space.sm }}><Button tone="quiet" label={taken ? `✓ ${retakeLabel}` : label} onPress={() => { setTooBig(false); setOpen(true); }} />{tooBig ? <ErrorState code="UPLOAD_UNAVAILABLE" /> : null}</View>;

  async function shoot() {
    setBusy(true);
    try {
      const pic = await ref.current?.takePictureAsync({ quality: 0.8, skipProcessing: true }); if (!pic) return;
      const out = await compressToLimit(async (q) => {
        const r = await manipulateAsync(pic.uri, pic.width > MAX_WIDTH ? [{ resize: { width: MAX_WIDTH } }] : [], { compress: q, format: SaveFormat.JPEG });
        return { uri: r.uri, width: r.width, height: r.height, size: new File(r.uri).size };
      });
      try { new File(pic.uri).delete(); } catch { /* camera cache cleans itself */ }
      if (!out.fits) { setTooBig(true); setOpen(false); return; }
      onCaptured({ uri: out.uri, width: out.width, height: out.height }); setTaken(true); setOpen(false);
    } finally { setBusy(false); }
  }
  return (
    <View style={{ gap: space.sm }}>
      <CameraView ref={ref} mode="picture" style={{ height: 320, borderRadius: radius.sheet, overflow: 'hidden' }} facing="back" />
      <Button tone="primary" busy={busy} label={label} onPress={() => void shoot()} />
      <Button tone="quiet" label={t('app.cancel')} onPress={() => setOpen(false)} />
    </View>
  );
}