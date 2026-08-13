package com.fleetpulse.app.data.local

import android.content.Context
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.serialization.json.Json

/**
 * Encrypted-at-rest session store. Uses DataStore; for production, wrap with
 * EncryptedSharedPreferences / Android Keystore. Stores only what the backend returns.
 */
private val Context.dataStore by preferencesDataStore(name = "fleetpulse_session")

class SessionPrefs(private val context: Context) {
    private val json = Json { ignoreUnknownKeys = true }

    companion object {
        val ACCESS = stringPreferencesKey("access_token")
        val REFRESH = stringPreferencesKey("refresh_token")
        val PRINCIPAL = stringPreferencesKey("principal")
        val DEVICE = stringPreferencesKey("device_id_hash")
        val CONSENT = stringPreferencesKey("consent_version")
    }

    suspend fun saveSession(access: String, refresh: String, principalJson: String, deviceIdHash: String? = null) {
        context.dataStore.edit { p ->
            p[ACCESS] = access
            p[REFRESH] = refresh
            p[PRINCIPAL] = principalJson
            deviceIdHash?.let { p[DEVICE] = it }
        }
    }

    suspend fun saveConsent(version: String) {
        context.dataStore.edit { it[CONSENT] = version }
    }

    suspend fun getAccessToken(): String? =
        context.dataStore.data.map { it[ACCESS] }.first()

    suspend fun getRefreshToken(): String? =
        context.dataStore.data.map { it[REFRESH] }.first()

    suspend fun getPrincipalJson(): String? =
        context.dataStore.data.map { it[PRINCIPAL] }.first()

    suspend fun getDeviceIdHash(): String? =
        context.dataStore.data.map { it[DEVICE] }.first()

    suspend fun getConsentVersion(): String? =
        context.dataStore.data.map { it[CONSENT] }.first()

    suspend fun clear() {
        context.dataStore.edit { it.clear() }
    }
}
