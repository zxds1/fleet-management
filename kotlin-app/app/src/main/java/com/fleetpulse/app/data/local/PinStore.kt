package com.fleetpulse.app.data.local

import android.content.Context
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.intPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import java.security.MessageDigest
import java.security.SecureRandom

/**
 * Local, offline-only PIN storage backing the OfflinePinScreen (CONTRACTS.md: OFFLINE_PIN_LOCKED,
 * B12/B13). The PIN unlocks the encrypted offline write queue when there is no network — it is a
 * LOCAL secret and is never sent to the backend. Only a salted SHA-256 hash is persisted; the raw
 * PIN is never stored.
 *
 * Failure policy (mirrors CONTRACTS.md):
 *  - 5 consecutive wrong attempts  → LOCKED (must re-auth online to reset).
 *  - 10 consecutive wrong attempts → WIPE local session/queue for safety.
 */
private val Context.pinDataStore by preferencesDataStore(name = "fleetpulse_pin")

class PinStore(private val context: Context) {

    companion object {
        private val PIN_HASH = stringPreferencesKey("pin_hash")
        private val PIN_SALT = stringPreferencesKey("pin_salt")
        private val FAIL_COUNT = intPreferencesKey("pin_fail_count")

        const val MAX_ATTEMPTS_LOCK = 5
        const val MAX_ATTEMPTS_WIPE = 10
        const val PIN_LENGTH = 4
    }

    /** Result of a verify attempt so the UI can react without owning the counting logic. */
    sealed interface VerifyResult {
        data object Ok : VerifyResult
        data class Wrong(val attemptsRemaining: Int) : VerifyResult
        data object Locked : VerifyResult
        data object Wiped : VerifyResult
        data object NoPinSet : VerifyResult
    }

    suspend fun hasPin(): Boolean =
        context.pinDataStore.data.map { !it[PIN_HASH].isNullOrBlank() }.first()

    suspend fun failCount(): Int =
        context.pinDataStore.data.map { it[FAIL_COUNT] ?: 0 }.first()

    suspend fun isLocked(): Boolean = failCount() >= MAX_ATTEMPTS_LOCK

    /** Set (or replace) the PIN and reset the failure counter. */
    suspend fun setPin(pin: String) {
        require(isValidPin(pin)) { "PIN must be $PIN_LENGTH digits" }
        val salt = newSalt()
        context.pinDataStore.edit {
            it[PIN_SALT] = salt
            it[PIN_HASH] = hash(pin, salt)
            it[FAIL_COUNT] = 0
        }
    }

    /**
     * Verify [pin] against the stored hash. Increments the failure counter on a miss and returns the
     * lock/wipe decision. On success the counter is cleared. Callers must react to [VerifyResult.Wiped]
     * by clearing session + queue via the repository.
     */
    suspend fun verify(pin: String): VerifyResult {
        val prefs = context.pinDataStore.data.first()
        val storedHash = prefs[PIN_HASH]
        val salt = prefs[PIN_SALT]
        if (storedHash.isNullOrBlank() || salt.isNullOrBlank()) return VerifyResult.NoPinSet
        val current = prefs[FAIL_COUNT] ?: 0
        if (current >= MAX_ATTEMPTS_WIPE) return VerifyResult.Wiped
        if (current >= MAX_ATTEMPTS_LOCK) return VerifyResult.Locked

        return if (constantTimeEquals(hash(pin, salt), storedHash)) {
            context.pinDataStore.edit { it[FAIL_COUNT] = 0 }
            VerifyResult.Ok
        } else {
            val next = current + 1
            context.pinDataStore.edit { it[FAIL_COUNT] = next }
            when {
                next >= MAX_ATTEMPTS_WIPE -> VerifyResult.Wiped
                next >= MAX_ATTEMPTS_LOCK -> VerifyResult.Locked
                else -> VerifyResult.Wrong(MAX_ATTEMPTS_LOCK - next)
            }
        }
    }

    /** Clear the failure counter after a successful online re-auth (unlocks the PIN). */
    suspend fun resetFailures() {
        context.pinDataStore.edit { it[FAIL_COUNT] = 0 }
    }

    /** Remove the PIN entirely (e.g. on wipe / logout). */
    suspend fun clear() {
        context.pinDataStore.edit { it.clear() }
    }

    fun isValidPin(pin: String): Boolean = pin.length == PIN_LENGTH && pin.all { it.isDigit() }

    private fun newSalt(): String {
        val bytes = ByteArray(16)
        SecureRandom().nextBytes(bytes)
        return bytes.joinToString("") { "%02x".format(it) }
    }

    private fun hash(pin: String, salt: String): String {
        val digest = MessageDigest.getInstance("SHA-256")
        val out = digest.digest((salt + pin).toByteArray(Charsets.UTF_8))
        return out.joinToString("") { "%02x".format(it) }
    }

    private fun constantTimeEquals(a: String, b: String): Boolean {
        if (a.length != b.length) return false
        var result = 0
        for (i in a.indices) result = result or (a[i].code xor b[i].code)
        return result == 0
    }
}
