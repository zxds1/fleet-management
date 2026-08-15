import React from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { colors, spacing, typography } from "../theme";

/** Mirrors OfflineBanner (Kotlin SharedComponents). */
export function OfflineBanner({
  isNetworkConnected,
  pendingQueueCount,
  onOpenOutbox,
}: {
  isNetworkConnected: boolean;
  pendingQueueCount: number;
  onOpenOutbox: () => void;
}) {
  if (isNetworkConnected && pendingQueueCount === 0) return null;
  return (
    <View
      style={[
        bannerStyles.banner,
        {
          backgroundColor: isNetworkConnected ? colors.surfaceDim : colors.surfaceDim,
          borderBottomWidth: 1,
          borderBottomColor: colors.outlineVariant,
        },
      ]}
    >
      <Text style={[bannerStyles.text, { color: isNetworkConnected ? colors.info : colors.warning }]}>
        {isNetworkConnected ? `${pendingQueueCount} pending write(s) syncing…` : "Offline — writes queued locally"}
      </Text>
      {pendingQueueCount > 0 ? (
        <TouchableOpacity onPress={onOpenOutbox}>
          <Text style={[bannerStyles.link, { color: colors.primary }]}>Outbox</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const bannerStyles = StyleSheet.create({
  banner: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  text: { fontSize: 12, flex: 1 },
  link: { fontSize: 12, fontWeight: "600", marginLeft: spacing.sm },
});

/** Mirrors EmptyState (Kotlin). */
export function EmptyState({ title, message }: { title: string; message: string }) {
  return (
    <View style={centerStyles.center}>
      <Text style={[typography.titleMedium, { color: colors.onSurface }]}>{title}</Text>
      <Text style={[typography.bodyMedium, { color: colors.onSurfaceVariant, marginTop: 6, textAlign: "center" }]}>
        {message}
      </Text>
    </View>
  );
}

/** Mirrors ErrorState (Kotlin). */
export function ErrorState({ message, onRetry }: { message: string; onRetry?: (() => void) | null }) {
  return (
    <View style={centerStyles.center}>
      <Text style={[typography.titleMedium, { color: colors.onSurface }]}>Something went wrong</Text>
      <Text style={[typography.bodyMedium, { color: colors.onSurfaceVariant, marginTop: 6, textAlign: "center" }]}>
        {message}
      </Text>
      {onRetry ? (
        <TouchableOpacity
          onPress={onRetry}
          style={{ marginTop: spacing.lg, backgroundColor: colors.primary, borderRadius: 0, paddingHorizontal: 20, paddingVertical: 10 }}
        >
          <Text style={{ color: colors.onPrimary, fontWeight: "600" }}>Retry</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

/** Mirrors LoadingIndicator (Kotlin). */
export function LoadingIndicator() {
  return (
    <View style={centerStyles.center}>
      <Text style={[typography.bodyMedium, { color: colors.onSurfaceVariant }]}>Loading…</Text>
    </View>
  );
}

const centerStyles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32 },
});
