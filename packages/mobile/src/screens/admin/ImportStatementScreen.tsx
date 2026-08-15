import React, { useState } from "react";
import { View, Text, TouchableOpacity } from "react-native";
import { colors, typography } from "../../theme";
import { repository } from "../../repo/FleetRepository";
import { useStore } from "../../store";
import { Screen, ScreenHeader } from "../../components/Screen";
import { SectionCard } from "../../components/SectionCard";
import { FleetButton } from "../../components/FleetButton";
import { EmptyState } from "../../components/States";
import { fmtDateTime } from "../../utils/format";

/** Admin import statement → verify purchase against provider ledger. Mirrors StatementFragment. */
export function ImportStatementScreen({ navigation }: { navigation: any }) {
  const purchases = useStore(repository.pendingPurchases);
  const [done, setDone] = useState<string | null>(null);

  const verify = async (id: string) => {
    await repository.verifyPurchase(id, "approve", "Verified via mobile import");
    setDone(id);
  };

  return (
    <Screen>
      <ScreenHeader title="Import Statement" onBack={() => navigation.goBack()} />
      {purchases.length === 0 ? (
        <EmptyState title="No pending statements" message="Imported purchases awaiting verification appear here." />
      ) : (
        purchases.map((p) => (
          <SectionCard key={p.id}>
            <Text style={[typography.bodyLarge, { color: colors.onSurface, fontWeight: "600" }]}>{p.stationName ?? "Station"} · {p.vehiclePlate ?? ""}</Text>
            <Text style={[typography.bodySmall, { color: colors.onSurfaceVariant }]}>
              ${p.amountSpent?.toFixed(2) ?? "0.00"} · {p.litersPumped ?? 0} L · {p.receiptDate ? fmtDateTime(new Date(p.receiptDate).getTime()) : ""}
            </Text>
            {done === p.id ? (
              <Text style={{ color: colors.statusSafe, marginTop: 8 }}>Verified</Text>
            ) : (
              <FleetButton text="Verify purchase" onPress={() => verify(p.id)} enabled={!done} style={{ marginTop: 8 }} />
            )}
          </SectionCard>
        ))
      )}
    </Screen>
  );
}

