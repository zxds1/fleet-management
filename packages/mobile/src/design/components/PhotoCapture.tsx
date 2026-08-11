// packages/mobile/src/design/components/PhotoCapture.tsx
//
// Photo capture control. The actual camera bridge (expo-camera / ImagePicker) is wired in Phase 3;
// here we define the contract: the component reports an asset via `onCapture(asset)` where `asset`
// is a pointer the offline queue can later upload (presigned URL per C5.4). The visual matches the
// required evidence photos (start/end odometer, gauge before/after, DVIR defect, accident media).

import React from "react";
import { View, TouchableOpacity } from "react-native";
import { theme } from "../theme";
import { Text } from "./Text";
import { t } from "@/core/i18n";

export interface CapturedPhoto {
  /** Local URI; later exchanged for a presigned upload URL (C5.4 — no secret in client log). */
  uri: string;
  width: number;
  height: number;
  /** Bytes; used to reject oversized images (media.tooLarge). */
  size: number;
  createdAt: string;
}

export interface PhotoCaptureProps {
  label?: string;
  value?: CapturedPhoto | null;
  required?: boolean;
  /** Max bytes before we reject and ask for a retake. */
  maxBytes?: number;
  onCapture: (photo: CapturedPhoto) => void;
  onRemove?: () => void;
  testID?: string;
}

export function PhotoCapture({
  label,
  value,
  required,
  maxBytes = 5 * 1024 * 1024,
  onCapture,
  onRemove,
  testID,
}: PhotoCaptureProps) {
  return (
    <View testID={testID ?? "photo-capture"} style={{ marginVertical: theme.spacing[3] }}>
      {label && (
        <Text style={{ ...theme.textStyle.label01, color: theme.colors.textSecondary, marginBottom: theme.spacing[2] }}>
          {label}
          {required ? " *" : ""}
        </Text>
      )}
      {value ? (
        <View>
          {/* The thumbnail is drawn by the native layer; here we show the placeholder box + actions. */}
          <View
            style={{
              height: 160,
              backgroundColor: theme.colors.ui02,
              borderWidth: 1,
              borderColor: theme.colors.ui03,
              justifyContent: "center",
              alignItems: "center",
            }}
          >
            <Text preset="label01" color={theme.colors.textSecondary}>{t("media.storedOffline")}</Text>
          </View>
          <View style={{ flexDirection: "row", marginTop: theme.spacing[2] }}>
            <TouchableOpacity accessibilityRole="button" onPress={() => onCapture(value)} hitSlop={8} style={{ minHeight: theme.sizing.minTouchTarget, justifyContent: "center" }}>
              <Text preset="label02" color={theme.colors.interactive01}>{t("media.retake")}</Text>
            </TouchableOpacity>
            {onRemove && (
              <TouchableOpacity accessibilityRole="button" onPress={onRemove} hitSlop={8} style={{ minHeight: theme.sizing.minTouchTarget, justifyContent: "center", marginLeft: theme.spacing[5] }}>
                <Text preset="label02" color={theme.colors.supportError}>{t("media.remove")}</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      ) : (
        <TouchableOpacity
          accessibilityRole="button"
          onPress={() => onCapture({ uri: "", width: 0, height: 0, size: 0, createdAt: new Date().toISOString() })}
          style={{
            height: 120,
            borderWidth: 2,
            borderStyle: "dashed",
            borderColor: theme.colors.interactive01,
            justifyContent: "center",
            alignItems: "center",
          }}
        >
          <Text preset="label02" color={theme.colors.interactive01}>{t("media.takePhoto")}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}
