import React from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { commandColors as c, commandSpacing, mono } from "../../screens/admin/commandCenterTheme";
import { repository } from "../../repo/FleetRepository";
import { useStore } from "../../store";
import { StatusDot } from "../../components/StatusDot";
import { EmptyState } from "../../components/States";
import { relativeTime } from "../../utils/format";

export function AccidentsConsoleScreen({ navigation }: { navigation: any }) {
  const accidents = useStore(repository.accidents);
  return (
    <View style={styles.safe}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Text style={styles.backText}>Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Accidents Console</Text>
        <View style={styles.headerRight} />
      </View>
      {accidents.length === 0 ? (
        <EmptyState title="No accidents" message="Reported accidents appear here." />
      ) : (
        <View style={styles.content}>
          {accidents.map((a) => {
            const isOpen = a.status === "PENDING" || a.status === "INVESTIGATING";
            const severityColor = isOpen ? c.dangerSoft : c.successSoft;
            return (
              <TouchableOpacity
                key={a.id}
                activeOpacity={0.8}
                onPress={() => navigation.navigate("driver_accident_detail", { id: a.id })}
                style={styles.card}
              >
                <View style={styles.cardTopRow}>
                  <Text style={[styles.cardTitle, mono]}>
                    {a.vehicleId ?? "Vehicle"} · {a.tierLevel}
                  </Text>
                  <View style={styles.severityRow}>
                    <StatusDot color={severityColor} />
                    <Text style={[styles.severityText, { color: severityColor }]}>{a.status}</Text>
                  </View>
                </View>
                <Text style={styles.cardBody}>
                  {a.locationName ?? ""} · {relativeTime(a.createdAt)}
                </Text>
                <View style={styles.cardActions}>
                  {a.status !== "INVESTIGATING" && a.status !== "RESOLVED" ? (
                    <TouchableOpacity onPress={() => repository.acknowledgeAccident(a.id)}>
                      <Text style={[styles.actionText, { color: c.blueSoft }]}>Acknowledge</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
              </TouchableOpacity>
            );
          })}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: c.canvas },
  header: {
    minHeight: 52,
    paddingHorizontal: commandSpacing.lg,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomWidth: 1,
    borderBottomColor: c.border,
    backgroundColor: c.canvas,
  },
  backButton: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  backText: { color: c.blueSoft, fontSize: 14, fontWeight: "600" },
  headerTitle: { color: c.text, fontSize: 18, fontWeight: "700", letterSpacing: -0.3 },
  headerRight: { width: 40 },
  content: { flex: 1, padding: commandSpacing.lg, gap: commandSpacing.md },
  card: {
    padding: commandSpacing.lg,
    backgroundColor: "rgba(18,18,22,0.94)",
    borderWidth: 1,
    borderColor: c.borderStrong,
  },
  cardTopRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  cardTitle: { color: c.white, fontSize: 13, fontWeight: "600" },
  severityRow: { flexDirection: "row", alignItems: "center", gap: 7 },
  severityText: { fontSize: 9, fontWeight: "700", letterSpacing: 1 },
  cardBody: { color: c.textMuted, fontSize: 12, marginTop: 4 },
  cardActions: { flexDirection: "row", gap: commandSpacing.sm, marginTop: commandSpacing.sm },
  actionText: { fontSize: 12, fontWeight: "600" },
});
