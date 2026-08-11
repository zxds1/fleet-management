// packages/mobile/src/screens/admin/DriverDetailScreen.tsx
//
// C.18 Driver Detail (MFA enrollment, D-12). Shows status, roles/permissions, last login and the
// registered devices, and exposes the four privileged actions:
//   • **Enroll MFA**      → `POST /auth/mfa/enroll` → QR / setup key + one-time recovery codes,
//                            handed to the driver in person; the first driver code activates it.
//   • **Revoke device**   → `device:revoke`
//   • **Revoke sessions** → `POST /admin/users/{id}/revoke-sessions` (forces re-auth, B13)
//   • **Suspend / Reinstate**
//
// Visual reference: `driver_management` (Carbon table styling, status chips, verified_user MFA
// glyph, squared cards).

import React, { useCallback, useEffect, useState } from "react"
import { View, ScrollView } from "react-native"
import { theme } from "@/design/theme"
import { Text } from "@/design/components/Text"
import { Button } from "@/design/components/Button"
import { Card } from "@/design/components/Card"
import { Input } from "@/design/components/Input"
import { Icon } from "@/design/components/Icon"
import { StatusBadge } from "@/design/components/StatusBadge"
import { DataTable } from "@/design/components/DataTable"
import { EmptyState } from "@/design/components/EmptyState"
import { t } from "@/core/i18n"
import type { Services } from "@/services"
import type { DriverDetail as DriverDetailDto } from "@/core/admin"

/** Minimal shape of `GET /drivers/{id}`. */
export interface DriverDevice {
  device_id?: string | null
  device_name?: string | null
  platform?: string | null
  last_seen_at?: string | null
  registered_at?: string | null
  revoked?: boolean | null
}

export interface DriverMfaEnrollment {
  provisioning_uri?: string | null
  setup_key?: string | null
  recovery_codes?: string[] | null
}

export interface DriverDetail {
  user_id?: string | null
  full_name?: string | null
  phone?: string | null
  email?: string | null
  /** `ACTIVE` | `PENDING` | `SUSPENDED` */
  status?: string | null
  roles?: string[] | null
  permissions?: string[] | null
  mfa_enrolled?: boolean | null
  last_login_at?: string | null
  last_login_ip?: string | null
  assigned_vehicle_plate?: string | null
  devices?: DriverDevice[] | null
  /** Present only immediately after an enrollment call — shown once, never re-fetchable. */
  mfa_enrollment?: DriverMfaEnrollment | null
}

export interface DriverDetailScreenProps {
  services: Services
  /** Driver selected in `DriversScreen`. */
  id?: string
  onBack: () => void
  /** Optional overrides — the screen fetches its own data when these are omitted. */
  driver?: DriverDetail
  onEnrollMfa?: () => void
  onRevokeDevice?: (deviceId: string) => void
  onRevokeSessions?: () => void
  onToggleSuspend?: () => void
}

/** Maps the `DriverDetail` DTO from `services.admin.drivers.getOne` onto this screen's view shape. */
function toView(dto: DriverDetailDto): DriverDetail {
  return {
    user_id: dto.user_id,
    full_name: dto.full_name ?? null,
    phone: dto.phone ?? null,
    email: dto.email ?? null,
    status: dto.status,
    roles: dto.roles ?? null,
    permissions: dto.permissions ?? null,
    mfa_enrolled: dto.mfa_enrolled,
    last_login_at: dto.last_login_at ?? null,
    devices: (dto.devices ?? []).map((d) => ({
      device_id: d.device_id,
      platform: d.platform,
      last_seen_at: d.last_seen_at ?? null,
    })),
  }
}

export function DriverDetailScreen({
  services,
  id,
  onBack,
  driver: driverProp,
  onEnrollMfa,
  onRevokeDevice,
  onRevokeSessions,
  onToggleSuspend,
}: DriverDetailScreenProps) {
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [fetched, setFetched] = useState<DriverDetail | null>(null)
  const [enrollment, setEnrollment] = useState<DriverMfaEnrollment | null>(null)
  // `POST /auth/mfa/enroll` is authorised with the admin's own password (A3.7).
  const [enrolling, setEnrolling] = useState(false)
  const [password, setPassword] = useState("")

  const refresh = useCallback(async () => {
    if (!id) {
      setLoading(false)
      return
    }
    const dto = await services.admin.drivers.getOne(id)
    setFetched(dto ? toView(dto) : null)
    setLoading(false)
  }, [services, id])

  // Load the roster so `getOne` can fall back to the cached row, then track roster mutations.
  useEffect(() => {
    void services.admin.drivers.load().then(refresh)
    const off = services.admin.drivers.onChange(() => void refresh())
    return off
  }, [services, refresh])

  const driver = driverProp ?? fetched
  const status = driver?.status ?? "ACTIVE"
  const suspended = status === "SUSPENDED"
  const devices = driver?.devices ?? []
  const roles = driver?.roles ?? []
  const permissions = driver?.permissions ?? []
  const activeEnrollment = driver?.mfa_enrollment ?? enrollment
  const recoveryCodes = activeEnrollment?.recovery_codes ?? []

  const run = async (fn: () => void | Promise<void>) => {
    setBusy(true)
    try {
      await fn()
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  const enrollMfa = async () => {
    if (onEnrollMfa) {
      onEnrollMfa()
      return
    }
    if (!password) {
      setEnrolling(true)
      return
    }
    const res = await services.admin.security.enrollDriverMfa(password)
    setEnrollment({ provisioning_uri: res.provisioning_uri, setup_key: res.secret_encrypted_preview, recovery_codes: res.recovery_codes })
    setEnrolling(false)
    setPassword("")
  }

  const revokeDevice = (deviceId: string) =>
    onRevokeDevice ? onRevokeDevice(deviceId) : services.admin.security.revokeDevice(deviceId)

  const revokeSessions = () =>
    onRevokeSessions ? onRevokeSessions() : id ? services.admin.security.revokeAllSessions(id) : undefined

  const toggleSuspend = () => {
    if (onToggleSuspend) return onToggleSuspend()
    if (!id) return undefined
    return suspended ? services.admin.security.reinstate(id) : services.admin.security.suspend(id)
  }

  if (loading || !driver) {
    return (
      <ScrollView contentContainerStyle={{ padding: theme.spacing[5] }} testID="admin-driver-detail">
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: theme.spacing[4] }}>
          <Text preset="heading03" numberOfLines={1}>
            {t("admin.driverDetail.title")}
          </Text>
          <Button variant="ghost" fullWidth={false} onPress={onBack}>
            {t("common.back")}
          </Button>
        </View>
        <EmptyState
          title={loading ? t("common.loading") : t("admin.drivers.empty")}
          icon={<Icon name="group" size={32} color={theme.colors.outline} />}
        />
      </ScrollView>
    )
  }

  return (
    <ScrollView contentContainerStyle={{ padding: theme.spacing[5] }} testID="admin-driver-detail">
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: theme.spacing[4] }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: theme.spacing[3], flex: 1 }}>
          <Icon name="arrow_back" size={24} color={theme.colors.primary} />
          <Text preset="heading03" numberOfLines={1}>
            {t("admin.driverDetail.title")}
          </Text>
        </View>
        <Button variant="ghost" fullWidth={false} onPress={onBack}>
          {t("common.back")}
        </Button>
      </View>

      {/* Identity + status */}
      <Card
        variant="container"
        accent={suspended ? theme.colors.supportError : theme.colors.supportSuccess}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: theme.spacing[3] }}>
          <Icon name="person" size={24} color={theme.colors.primary} />
          <View style={{ flex: 1 }}>
            <Text preset="subtitle">{driver.full_name ?? driver.user_id ?? t("common.notAvailable")}</Text>
            <Text preset="caption" color={theme.colors.onSurfaceVariant}>
              {[driver.phone, driver.email].filter(Boolean).join(" · ") || t("common.notAvailable")}
            </Text>
          </View>
        </View>
        <View style={{ flexDirection: "row", gap: theme.spacing[2], marginTop: theme.spacing[3], flexWrap: "wrap" }}>
          <StatusBadge
            label={status}
            tone={status === "ACTIVE" ? "success" : status === "PENDING" ? "warning" : "danger"}
          />
          <StatusBadge
            label={driver.mfa_enrolled ? t("admin.drivers.mfaEnabled") : t("admin.drivers.mfaDisabled")}
            tone={driver.mfa_enrolled ? "success" : "warning"}
          />
          {driver.assigned_vehicle_plate ? <StatusBadge label={driver.assigned_vehicle_plate} tone="info" /> : null}
        </View>
      </Card>

      {/* Roles & permissions */}
      <Card variant="container" title={t("admin.driverDetail.rolesAndPermissions")}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: theme.spacing[2], marginBottom: theme.spacing[3] }}>
          <Icon name="badge" size={20} color={theme.colors.onSurfaceVariant} />
          <Text preset="label" color={theme.colors.onSurfaceVariant}>
            {t("admin.driverDetail.roles")}
          </Text>
        </View>
        {roles.length === 0 ? (
          <Text preset="body02" color={theme.colors.onSurfaceVariant}>
            {t("admin.driverDetail.noRoles")}
          </Text>
        ) : (
          <View style={{ flexDirection: "row", gap: theme.spacing[2], flexWrap: "wrap" }}>
            {roles.map((r) => (
              <StatusBadge key={r} label={r} tone="info" />
            ))}
          </View>
        )}

        <View style={{ flexDirection: "row", alignItems: "center", gap: theme.spacing[2], marginTop: theme.spacing[4], marginBottom: theme.spacing[3] }}>
          <Icon name="gavel" size={20} color={theme.colors.onSurfaceVariant} />
          <Text preset="label" color={theme.colors.onSurfaceVariant}>
            {t("admin.driverDetail.permissions")}
          </Text>
        </View>
        {permissions.length === 0 ? (
          <Text preset="body02" color={theme.colors.onSurfaceVariant}>
            {t("admin.driverDetail.noPermissions")}
          </Text>
        ) : (
          <View style={{ flexDirection: "row", gap: theme.spacing[2], flexWrap: "wrap" }}>
            {permissions.map((p) => (
              <StatusBadge key={p} label={p} tone="neutral" />
            ))}
          </View>
        )}
      </Card>

      {/* Last login */}
      <Card variant="container" title={t("admin.drivers.lastLogin")}>
        <View style={{ flexDirection: "row", alignItems: "flex-start", gap: theme.spacing[3] }}>
          <Icon name="history" size={20} color={theme.colors.onSurfaceVariant} />
          <View style={{ flex: 1 }}>
            <Text preset="body02">{driver.last_login_at ?? t("admin.driverDetail.neverLoggedIn")}</Text>
            {driver.last_login_ip ? (
              <Text preset="caption" color={theme.colors.onSurfaceVariant} style={{ marginTop: theme.spacing[1] }}>
                {driver.last_login_ip}
              </Text>
            ) : null}
          </View>
        </View>
      </Card>

      {/* Devices */}
      <Card variant="container" title={t("admin.drivers.devices")}>
        {devices.length === 0 ? (
          <EmptyState
            title={t("admin.driverDetail.noDevices")}
            description={t("admin.driverDetail.noDevicesDescription")}
            icon={<Icon name="verified_user" size={32} color={theme.colors.outline} />}
          />
        ) : (
          <DataTable<DriverDevice>
            testID="driver-devices-table"
            columns={[
              {
                key: "device",
                header: t("admin.driverDetail.device"),
                flex: 2,
                render: (d) => (
                  <View>
                    <Text preset="body02">{d.device_name ?? d.device_id ?? t("common.notAvailable")}</Text>
                    <Text preset="caption" color={theme.colors.onSurfaceVariant}>
                      {d.platform ?? t("common.notAvailable")}
                    </Text>
                  </View>
                ),
              },
              {
                key: "lastSeen",
                header: t("admin.driverDetail.lastSeen"),
                flex: 1,
                render: (d) => (
                  <Text preset="caption" color={theme.colors.onSurfaceVariant}>
                    {d.last_seen_at ?? t("common.notAvailable")}
                  </Text>
                ),
              },
              {
                key: "state",
                header: t("admin.driverDetail.deviceState"),
                flex: 1,
                align: "right",
                render: (d) => (
                  <StatusBadge
                    label={d.revoked ? t("admin.driverDetail.revoked") : t("admin.driverDetail.trusted")}
                    tone={d.revoked ? "danger" : "success"}
                  />
                ),
              },
            ]}
            rows={devices}
            rowActions={(d) => (
              <Button
                variant="ghost"
                fullWidth={false}
                disabled={busy || d.revoked === true || !d.device_id}
                onPress={() => void run(() => revokeDevice(d.device_id ?? ""))}
                testID="driver-revoke-device"
              >
                {t("admin.drivers.revokeDevice")}
              </Button>
            )}
          />
        )}
      </Card>

      {/* MFA enrollment result (shown once) */}
      {activeEnrollment ? (
        <Card variant="container" title={t("admin.drivers.enrollMfaTitle")} accent={theme.colors.supportWarning}>
          <Text preset="body02" color={theme.colors.onSurfaceVariant}>
            {t("admin.drivers.enrollMfaBody")}
          </Text>
          {activeEnrollment.provisioning_uri ? (
            <View style={{ marginTop: theme.spacing[4] }}>
              <Text preset="label" color={theme.colors.onSurfaceVariant}>
                {t("admin.driverDetail.provisioningUri")}
              </Text>
              <Text preset="body02" selectable style={{ marginTop: theme.spacing[2] }}>
                {activeEnrollment.provisioning_uri}
              </Text>
            </View>
          ) : null}
          {activeEnrollment.setup_key ? (
            <View style={{ marginTop: theme.spacing[4] }}>
              <Text preset="label" color={theme.colors.onSurfaceVariant}>
                {t("admin.drivers.setupKey")}
              </Text>
              <Text preset="body02" selectable style={{ marginTop: theme.spacing[2] }}>
                {activeEnrollment.setup_key}
              </Text>
            </View>
          ) : null}
          {recoveryCodes.length > 0 ? (
            <View style={{ marginTop: theme.spacing[4] }}>
              <Text preset="label" color={theme.colors.onSurfaceVariant}>
                {t("admin.drivers.recoveryCodes")}
              </Text>
              {recoveryCodes.map((c) => (
                <Text key={c} preset="body02" selectable style={{ marginTop: theme.spacing[2] }}>
                  {c}
                </Text>
              ))}
              <Text preset="caption" color={theme.colors.error} style={{ marginTop: theme.spacing[3] }}>
                {t("admin.drivers.recoveryCodesWarning")}
              </Text>
            </View>
          ) : null}
        </Card>
      ) : null}

      {/* Actions */}
      <Card variant="container" title={t("admin.driverDetail.actions")}>
        <View style={{ gap: theme.spacing[3] }}>
          {enrolling ? (
            <Input
              label={t("auth.password")}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              testID="driver-enroll-password"
            />
          ) : null}
          <Button
            variant="primary"
            loading={busy}
            onPress={() => void run(enrollMfa)}
            icon={<Icon name="verified_user" size={20} color={theme.colors.onPrimary} />}
            testID="driver-enroll-mfa"
          >
            {t("admin.drivers.enrollMfa")}
          </Button>
          <Button
            variant="secondary"
            loading={busy}
            onPress={() => void run(revokeSessions)}
            icon={<Icon name="sync" size={20} color={theme.colors.primary} />}
            testID="driver-revoke-sessions"
          >
            {t("admin.drivers.revokeSessions")}
          </Button>
          <Text preset="caption" color={theme.colors.onSurfaceVariant}>
            {t("admin.drivers.revokeSessionsConfirm")}
          </Text>
          <Button
            variant={suspended ? "secondary" : "danger"}
            loading={busy}
            onPress={() => void run(toggleSuspend)}
            testID="driver-toggle-suspend"
          >
            {suspended ? t("admin.drivers.reinstate") : t("admin.drivers.suspend")}
          </Button>
          <Text preset="caption" color={theme.colors.onSurfaceVariant}>
            {suspended ? t("admin.driverDetail.reinstateHelp") : t("admin.driverDetail.suspendHelp")}
          </Text>
        </View>
      </Card>
    </ScrollView>
  )
}
