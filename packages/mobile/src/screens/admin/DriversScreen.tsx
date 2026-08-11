// packages/mobile/src/screens/admin/DriversScreen.tsx
//
// Driver management: MFA enrollment (D-12) + device/session revoke. The roster is loaded from the
// locked contract endpoint `GET /drivers` via `DriverRosterService`; device/session revoke bind to
// `POST /devices/{deviceId}/revoke` and `POST /sessions/revoke`. Errors surface via the error catalogue.

import React, { useEffect, useMemo, useState } from "react"
import { View, ScrollView, Pressable } from "react-native"
import { theme } from "@/design/theme"
import { Text } from "@/design/components/Text"
import { Button } from "@/design/components/Button"
import { Card } from "@/design/components/Card"
import { EmptyState } from "@/design/components/EmptyState"
import { StatusBadge } from "@/design/components/StatusBadge"
import { Input } from "@/design/components/Input"
import { Icon } from "@/design/components/Icon"
import { DataTable, type DataTableColumn } from "@/design/components/DataTable"
import { t } from "@/core/i18n"
import type { Services } from "@/services"
import type { DriverSummary } from "@/core/admin"

export interface DriversScreenProps {
  services: Services
  onBack: () => void
  /** Opens `DriverDetailScreen` for the selected driver. */
  onSelect?: (userId: string) => void
}

export function DriversScreen({ services, onBack, onSelect }: DriversScreenProps) {
  const [drivers, setDrivers] = useState<DriverSummary[]>([])
  const [selected, setSelected] = useState<DriverSummary | null>(null)
  const [password, setPassword] = useState("")
  const [enroll, setEnroll] = useState<{ uri: string; codes: string[] } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [creating, setCreating] = useState(false)
  const [query, setQuery] = useState("")
  const [newPhone, setNewPhone] = useState("")
  const [newName, setNewName] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [newLicenceNumber, setNewLicenceNumber] = useState("")
  const [newLicenceClass, setNewLicenceClass] = useState("")
  const [newEmergencyName, setNewEmergencyName] = useState("")
  const [newEmergencyPhone, setNewEmergencyPhone] = useState("")

  // Load the roster from the locked `GET /drivers` contract on mount (admin console).
  useEffect(() => {
    let active = true
    services.admin.drivers.load().catch((e) => active && setError((e as Error).message))
    const unsub = services.admin.drivers.onChange(() => setDrivers([...services.admin.drivers.drivers]))
    return () => {
      active = false
      unsub()
    }
  }, [services])

  const refreshRoster = () => services.admin.drivers.load().then(() => setDrivers([...services.admin.drivers.drivers])).catch((e) => setError((e as Error).message))

  const doEnroll = async () => {
    if (!selected || !password) return
    setBusy(true)
    setError(undefined)
    try {
      const res = await services.admin.security.enrollDriverMfa(password)
      setEnroll({ uri: res.provisioning_uri, codes: res.recovery_codes })
      // `POST /auth/mfa/enroll` enrolls the *admin's own* MFA (A3.7) and does NOT
      // take a target user_id, so we must NOT mark the selected driver enrolled here —
      // doing so would misreport the driver's real MFA status in the roster.
      void selected
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const doRevokeDevice = async (deviceId: string) => {
    setBusy(true)
    try {
      await services.admin.security.revokeDevice(deviceId)
      await refreshRoster()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const doRevokeSessions = async (userId: string) => {
    setBusy(true)
    try {
      await services.admin.security.revokeAllSessions(userId)
      await refreshRoster()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const doApprove = async (userId: string) => {
    setBusy(true)
    try {
      await services.admin.drivers.approveDriver(userId)
      await refreshRoster()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const doCreate = async () => {
    setBusy(true)
    setError(undefined)
    try {
      await services.admin.drivers.createDriver({
        phone: newPhone.trim(),
        full_name: newName.trim(),
        password: newPassword,
        ...(newLicenceNumber.trim() ? { licence_number: newLicenceNumber.trim() } : {}),
        ...(newLicenceClass.trim() ? { licence_class: newLicenceClass.trim() } : {}),
        ...(newEmergencyName.trim() ? { emergency_contact_name: newEmergencyName.trim() } : {}),
        ...(newEmergencyPhone.trim() ? { emergency_contact_phone: newEmergencyPhone.trim() } : {}),
      })
      setCreating(false)
      setNewPhone("")
      setNewName("")
      setNewPassword("")
      setNewLicenceNumber("")
      setNewLicenceClass("")
      setNewEmergencyName("")
      setNewEmergencyPhone("")
      await refreshRoster()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return drivers
    return drivers.filter((d) =>
      [d.full_name, d.phone, d.email, d.user_id, d.status].some((v) => (v ?? "").toLowerCase().includes(q)),
    )
  }, [drivers, query])

  // Carbon DataTable columns (spec `driver_management`): Name / ID / Status / Vehicle / MFA.
  // `Actions` is rendered through `rowActions` so the edit affordance keeps a 48px touch target.
  const columns: DataTableColumn<DriverSummary>[] = [
    {
      key: "name",
      header: t("admin.drivers.colName"),
      flex: 2,
      render: (d) => (
        <View>
          <Text preset="bodyStrong">{d.full_name ?? d.phone ?? d.email ?? d.user_id}</Text>
          <Text preset="caption" color={theme.colors.textSecondary}>
            {d.phone ?? d.email ?? t("common.notAvailable")}
          </Text>
        </View>
      ),
    },
    {
      key: "id",
      header: t("admin.drivers.colId"),
      flex: 1.5,
      render: (d) => (
        <Text preset="caption" color={theme.colors.textSecondary}>
          {d.user_id.slice(0, 8)}
        </Text>
      ),
    },
    {
      key: "status",
      header: t("admin.drivers.colStatus"),
      flex: 1.5,
      render: (d) => (
        <StatusBadge
          label={d.status}
          tone={d.status === "ACTIVE" ? "success" : d.status === "PENDING" ? "warning" : "danger"}
        />
      ),
    },
    {
      key: "vehicle",
      header: t("admin.drivers.colVehicle"),
      flex: 2,
      render: (d) => (
        <Text preset="body" color={d.devices?.length ? theme.colors.textPrimary : theme.colors.textSecondary}>
          {d.devices?.[0]?.device_id ?? t("admin.drivers.unassigned")}
        </Text>
      ),
    },
    {
      key: "mfa",
      header: t("admin.drivers.colMfa"),
      flex: 1.5,
      render: (d) => (
        <StatusBadge
          label={d.mfa_enrolled ? t("admin.drivers.mfaEnabled") : t("admin.drivers.mfaDisabled")}
          tone={d.mfa_enrolled ? "success" : "warning"}
        />
      ),
    },
  ]

  if (selected && !enroll) {
    return (
      <ScrollView contentContainerStyle={{ padding: theme.spacing[5] }} testID="admin-driver-enroll">
        <Text preset="heading03">{t("admin.drivers.enrollMfaTitle")}</Text>
        <Text style={{ color: theme.colors.textSecondary, marginVertical: theme.spacing[3] }}>{t("admin.drivers.enrollMfaBody")}</Text>
        <Input label={t("auth.password")} value={password} onChangeText={setPassword} secureTextEntry testID="enroll-password" />
        {error ? <Text style={{ color: theme.colors.supportError }}>{error}</Text> : null}
        <Button variant="primary" loading={busy} disabled={!password} onPress={doEnroll}>{t("admin.drivers.enrollMfa")}</Button>
        {/* Account actions previously inlined on the roster card; kept here so the roster stays a table. */}
        <View style={{ marginTop: theme.spacing[4], gap: theme.spacing[3] }}>
          {onSelect ? (
            <Button variant="secondary" onPress={() => onSelect(selected.user_id)} testID="driver-details">
              {t("admin.dashboard.viewDetails")}
            </Button>
          ) : null}
          {selected.status === "PENDING" ? (
            <Button variant="primary" loading={busy} onPress={() => doApprove(selected.user_id)} testID="approve-driver">
              {t("admin.drivers.approve")}
            </Button>
          ) : null}
          <Button
            variant="ghost"
            disabled={!selected.devices?.length}
            onPress={() => doRevokeDevice(selected.devices?.[0]?.device_id ?? "")}
          >
            {t("admin.drivers.revokeDevice")}
          </Button>
          <Button variant="ghost" onPress={() => doRevokeSessions(selected.user_id)}>{t("admin.drivers.revokeSessions")}</Button>
        </View>
        <Button variant="ghost" onPress={() => setSelected(null)}>{t("common.back")}</Button>
      </ScrollView>
    )
  }

  if (enroll) {
    return (
      <ScrollView contentContainerStyle={{ padding: theme.spacing[5] }} testID="admin-mfa-result">
        <Text preset="heading03">{t("admin.drivers.enrollMfaTitle")}</Text>
        <Card style={{ marginVertical: theme.spacing[3] }}>
          <Text preset="label" color={theme.colors.textSecondary}>{t("admin.drivers.setupKey")}</Text>
          <Text selectable style={{ marginTop: theme.spacing[2] }}>{enroll.uri}</Text>
        </Card>
        <Card style={{ marginVertical: theme.spacing[3] }}>
          <Text preset="label" color={theme.colors.textSecondary}>{t("admin.drivers.recoveryCodes")}</Text>
          {enroll.codes.map((c) => (
            <Text key={c} selectable style={{ marginTop: theme.spacing[2] }}>{c}</Text>
          ))}
          <Text style={{ ...theme.textStyle.label01, color: theme.colors.textSecondary, marginTop: theme.spacing[2] }}>
            {t("admin.drivers.recoveryCodesWarning")}
          </Text>
        </Card>
        <Button variant="primary" onPress={() => { setSelected(null); setEnroll(null); setPassword("") }}>{t("common.done")}</Button>
      </ScrollView>
    )
  }

  if (creating) {
    return (
      <ScrollView contentContainerStyle={{ padding: theme.spacing[5] }} testID="admin-driver-create">
        <Text preset="heading03">{t("admin.drivers.createTitle")}</Text>
        <Text style={{ color: theme.colors.textSecondary, marginVertical: theme.spacing[3] }}>{t("admin.drivers.createBody")}</Text>
        <Input label={t("admin.drivers.phone")} value={newPhone} onChangeText={setNewPhone} keyboardType="phone-pad" testID="create-phone" />
        <Input label={t("admin.drivers.fullName")} value={newName} onChangeText={setNewName} testID="create-name" />
        <Input label={t("auth.password")} value={newPassword} onChangeText={setNewPassword} secureTextEntry testID="create-password" />
        <Input
          label={t("admin.drivers.licenceNumber")}
          value={newLicenceNumber}
          onChangeText={setNewLicenceNumber}
          autoCapitalize="characters"
          testID="create-licence-number"
        />
        <Input
          label={t("admin.drivers.licenceClass")}
          value={newLicenceClass}
          onChangeText={setNewLicenceClass}
          autoCapitalize="characters"
          testID="create-licence-class"
        />
        <Input
          label={t("admin.drivers.emergencyContactName")}
          value={newEmergencyName}
          onChangeText={setNewEmergencyName}
          testID="create-emergency-name"
        />
        <Input
          label={t("admin.drivers.emergencyContactPhone")}
          value={newEmergencyPhone}
          onChangeText={setNewEmergencyPhone}
          keyboardType="phone-pad"
          testID="create-emergency-phone"
        />
        {error ? <Text style={{ color: theme.colors.supportError, marginTop: theme.spacing[2] }}>{error}</Text> : null}
        <Button variant="primary" loading={busy} disabled={!newPhone || !newName || !newPassword} onPress={doCreate} testID="create-submit">
          {t("admin.drivers.create")}
        </Button>
        <Button
          variant="ghost"
          onPress={() => {
            setCreating(false)
            setError(undefined)
            setNewLicenceNumber("")
            setNewLicenceClass("")
            setNewEmergencyName("")
            setNewEmergencyPhone("")
          }}
        >
          {t("common.cancel")}
        </Button>
      </ScrollView>
    )
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.ui02 }} testID="admin-drivers">
      <ScrollView contentContainerStyle={{ padding: theme.spacing[5] }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: theme.spacing[3] }}>
          <View style={{ flex: 1, paddingRight: theme.spacing[3] }}>
            <Text preset="heading03">{t("admin.drivers.title")}</Text>
            <Text preset="caption" color={theme.colors.textSecondary} style={{ marginTop: theme.spacing[1] }}>
              {t("admin.drivers.subtitle")}
            </Text>
          </View>
          <Button variant="ghost" fullWidth={false} onPress={onBack}>{t("common.back")}</Button>
        </View>

        {/* Search + filter (spec: search field with leading `search` glyph, `filter_list` button). */}
        <View style={{ flexDirection: "row", alignItems: "flex-start", gap: theme.spacing[3], marginBottom: theme.spacing[3] }}>
          <View style={{ flex: 1 }}>
            <Input
              label={t("admin.drivers.search")}
              value={query}
              onChangeText={setQuery}
              placeholder={t("common.search")}
              testID="driver-search"
              trailing={<Icon name="search" size={theme.sizing.iconMd} color={theme.colors.textSecondary} />}
            />
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("admin.drivers.filter")}
            onPress={() => setQuery("")}
            testID="driver-filter"
            style={{
              width: theme.sizing.minTouchTarget,
              height: theme.sizing.minTouchTarget,
              marginTop: theme.spacing[5],
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: theme.colors.ui02,
              borderBottomWidth: 1,
              borderBottomColor: theme.colors.ui05,
            }}
          >
            <Icon name="filter_list" size={theme.sizing.iconMd} color={theme.colors.textSecondary} />
          </Pressable>
        </View>

        {error ? <Text style={{ color: theme.colors.supportError, marginBottom: theme.spacing[3] }}>{error}</Text> : null}

        {filtered.length === 0 ? (
          <EmptyState title={t("admin.drivers.empty")} />
        ) : (
          <Card variant="container" style={{ padding: 0 }}>
            <DataTable
              testID="drivers-table"
              columns={columns}
              rows={filtered}
              onRowPress={onSelect ? (d) => onSelect(d.user_id) : undefined}
              rowActions={(d) => (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t("admin.drivers.editDriver")}
                  onPress={() => setSelected(d)}
                  testID="driver-edit"
                  style={{
                    width: theme.sizing.minTouchTarget,
                    height: theme.sizing.minTouchTarget,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Icon name="edit" size={theme.sizing.iconMd} color={theme.colors.interactive01} />
                </Pressable>
              )}
            />
          </Card>
        )}
        <View style={{ height: theme.sizing.bottomNavHeight }} />
      </ScrollView>

      {/* FAB-style create action (spec: bottom-right primary FAB). */}
      <View style={{ position: "absolute", right: theme.spacing[5], bottom: theme.spacing[5] }}>
        <Button
          variant="primary"
          fullWidth={false}
          onPress={() => setCreating(true)}
          testID="create-driver"
          label={t("admin.drivers.create")}
          icon={<Icon name="add" size={theme.sizing.iconMd} color={theme.colors.textOnColor} />}
        />
      </View>
    </View>
  )
}
