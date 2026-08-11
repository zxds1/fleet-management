// packages/mobile/src/screens/admin/AdminProfileScreen.tsx
//
// Admin profile & settings (spec `admin_profile`). Shows the signed-in identity and lets the admin
// edit their own display name, phone and language. The only permitted self-write is
// `PUT /admin/users/me` (`services.admin.security.updateProfile`), wired here. Locale changes are
// applied immediately through the i18n runtime.

import React, { useCallback, useEffect, useState } from "react"
import { View, ScrollView } from "react-native"
import { theme } from "@/design/theme"
import { Text } from "@/design/components/Text"
import { Button } from "@/design/components/Button"
import { Card } from "@/design/components/Card"
import { Input } from "@/design/components/Input"
import { t, availableLocales, getLocale, setLocale, type Locale } from "@/core/i18n"
import { fromUnknown, type AppError } from "@/core/error"
import type { Services } from "@/services"

export interface AdminProfileScreenProps {
  services: Services
  email: string
  onLogout: () => void
  onBack: () => void
}

export function AdminProfileScreen({ services, email, onLogout, onBack }: AdminProfileScreenProps) {
  const [fullName, setFullName] = useState("")
  const [phone, setPhone] = useState("")
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<AppError>()
  const [saved, setSaved] = useState(false)

  const load = useCallback(async () => {
    try {
      const profile = await services.admin.security.getProfile()
      setFullName(profile.full_name ?? "")
      setPhone(profile.phone ?? "")
    } catch {
      // Profile read is best-effort; the fields just stay empty.
    } finally {
      setLoaded(true)
    }
  }, [services])

  useEffect(() => {
    void load()
  }, [load])

  const save = async () => {
    setBusy(true)
    setError(undefined)
    setSaved(false)
    try {
      await services.admin.security.updateProfile({
        full_name: fullName.trim() || undefined,
        phone: phone.trim() || null,
        locale: getLocale(),
      })
      setSaved(true)
    } catch (e) {
      setError(fromUnknown(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <ScrollView contentContainerStyle={{ padding: theme.spacing[5] }} testID="admin-profile">
      <View
        style={{
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: theme.spacing[4],
        }}
      >
        <Text preset="heading03">{t("driver.profile.title")}</Text>
        <Button variant="ghost" fullWidth={false} onPress={onBack}>
          {t("common.back")}
        </Button>
      </View>

      <Card style={{ marginBottom: theme.spacing[4] }}>
        <Text preset="label" color={theme.colors.textSecondary}>
          {t("auth.email")}
        </Text>
        <Text preset="body02" style={{ marginTop: theme.spacing[2] }}>
          {email}
        </Text>
      </Card>

      <Card style={{ marginBottom: theme.spacing[4] }}>
        <Text preset="label" color={theme.colors.textSecondary} style={{ marginBottom: theme.spacing[3] }}>
          {t("admin.profile.editTitle")}
        </Text>
        <Input
          label={t("auth.fullName")}
          value={fullName}
          onChangeText={setFullName}
          editable={loaded}
          placeholder={t("auth.fullNamePlaceholder")}
          testID="profile-full-name"
        />
        <Input
          label={t("auth.phone")}
          value={phone}
          onChangeText={setPhone}
          editable={loaded}
          placeholder={t("auth.phonePlaceholder")}
          testID="profile-phone"
        />
        {error ? (
          <Text preset="caption" color={theme.colors.supportError} style={{ marginTop: theme.spacing[2] }}>
            {error.message}
          </Text>
        ) : null}
        {saved ? (
          <Text preset="caption" color={theme.colors.supportSuccess} style={{ marginTop: theme.spacing[2] }}>
            {t("admin.profile.saved")}
          </Text>
        ) : null}
        <View style={{ marginTop: theme.spacing[3] }}>
          <Button variant="primary" loading={busy} onPress={save} testID="profile-save">
            {t("common.save")}
          </Button>
        </View>
      </Card>

      <Card style={{ marginBottom: theme.spacing[4] }}>
        <Text preset="label" color={theme.colors.textSecondary}>{t("common.language")}</Text>
        <View style={{ flexDirection: "row", gap: theme.spacing[2], marginTop: theme.spacing[3] }}>
          {availableLocales().map((l: Locale) => (
            <Button
              key={l}
              variant={getLocale() === l ? "primary" : "secondary"}
              fullWidth={false}
              onPress={() => setLocale(l)}
              testID={`admin-locale-${l}`}
            >
              {l === "en" ? t("common.english") : t("common.swahili")}
            </Button>
          ))}
        </View>
      </Card>

      <Button variant="danger" onPress={onLogout}>
        {t("auth.logOut")}
      </Button>
    </ScrollView>
  )
}
