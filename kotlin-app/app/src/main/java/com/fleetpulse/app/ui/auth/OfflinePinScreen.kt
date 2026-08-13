package com.fleetpulse.app.ui.auth

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import com.fleetpulse.app.data.local.PinStore
import com.fleetpulse.app.data.repo.FleetRepository
import com.fleetpulse.app.ui.components.FleetButton
import com.fleetpulse.app.ui.components.SectionCard
import com.fleetpulse.app.ui.theme.*
import kotlinx.coroutines.launch

/**
 * Offline re-auth gate (B12/B13, CONTRACTS.md OFFLINE_PIN_LOCKED). A LOCAL 4-digit PIN unlocks the
 * encrypted offline write queue while there is no network — it is verified against a locally-stored
 * salted hash in [PinStore] and is NEVER sent to the backend.
 *
 * Failure policy: 5 consecutive wrong attempts → locked (online sign-in required); 10 → local wipe.
 * When no PIN exists yet the screen switches to a set-up mode so the driver can create one.
 */
@Composable
fun OfflinePinScreen(
    repository: FleetRepository,
    onUnlocked: () -> Unit,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val pinStore = remember(context) { PinStore(context.applicationContext) }

    val principal by repository.principal.collectAsState()
    val locale = principal?.locale ?: "en"

    var pin by remember { mutableStateOf("") }
    var confirmPin by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var errorMessage by remember { mutableStateOf<String?>(null) }
    var setupMode by remember { mutableStateOf<Boolean?>(null) }
    var locked by remember { mutableStateOf(false) }
    var wiped by remember { mutableStateOf(false) }

    // Decide set-up vs unlock mode, and pick up an existing lockout, off the local store.
    LaunchedEffect(Unit) {
        val hasPin = pinStore.hasPin()
        setupMode = !hasPin
        if (hasPin && pinStore.isLocked()) {
            locked = true
            errorMessage = AuthStrings.pinLocked(locale)
        }
    }

    val isSetup = setupMode ?: false
    val inputsEnabled = !busy && !locked && !wiped

    AuthScaffold(
        title = if (isSetup) AuthStrings.pinSetupTitle(locale) else AuthStrings.pinTitle(locale),
        subtitle = if (isSetup) AuthStrings.pinSetupSubtitle(locale) else AuthStrings.pinSubtitle(locale),
        modifier = Modifier.testTag("offline_pin_screen"),
    ) {
        SectionCard {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Icon(Icons.Default.Lock, contentDescription = null, tint = BentoPurplePrimary, modifier = Modifier.size(22.dp))
                Text(
                    text = AuthStrings.pinLabel(locale),
                    style = MaterialTheme.typography.titleSmall,
                    color = BentoTextPrimary,
                )
            }
            Spacer(Modifier.height(14.dp))

            AuthTextField(
                value = pin,
                onValueChange = { input ->
                    if (input.length <= PinStore.PIN_LENGTH && input.all { it.isDigit() }) {
                        pin = input
                        errorMessage = null
                    }
                },
                label = AuthStrings.pinLabel(locale),
                enabled = inputsEnabled,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
                visualTransformation = PasswordVisualTransformation(),
                modifier = Modifier.testTag("offline_pin_input"),
            )

            if (isSetup) {
                Spacer(Modifier.height(12.dp))
                AuthTextField(
                    value = confirmPin,
                    onValueChange = { input ->
                        if (input.length <= PinStore.PIN_LENGTH && input.all { it.isDigit() }) confirmPin = input
                    },
                    label = AuthStrings.pinConfirmLabel(locale),
                    enabled = inputsEnabled,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
                    visualTransformation = PasswordVisualTransformation(),
                    modifier = Modifier.testTag("offline_pin_confirm_input"),
                )
            }

            errorMessage?.let {
                Spacer(Modifier.height(12.dp))
                if (locked || wiped) AuthNoticeBanner(it, tint = StatusWarning) else AuthErrorBanner(it)
            }

            Spacer(Modifier.height(20.dp))
            FleetButton(
                text = if (isSetup) AuthStrings.pinSaveBtn(locale) else AuthStrings.pinUnlockBtn(locale),
                onClick = {
                    if (busy || locked || wiped) return@FleetButton
                    if (pin.length != PinStore.PIN_LENGTH) {
                        errorMessage = AuthStrings.pinFourDigits(locale)
                        return@FleetButton
                    }
                    if (isSetup && pin != confirmPin) {
                        errorMessage = AuthStrings.pinMismatch(locale)
                        return@FleetButton
                    }
                    busy = true
                    errorMessage = null
                    scope.launch {
                        if (isSetup) {
                            pinStore.setPin(pin)
                            busy = false
                            onUnlocked()
                        } else {
                            when (val result = pinStore.verify(pin)) {
                                is PinStore.VerifyResult.Ok -> {
                                    pin = ""
                                    busy = false
                                    onUnlocked()
                                }
                                is PinStore.VerifyResult.Wrong -> {
                                    errorMessage = AuthStrings.pinWrong(locale, result.attemptsRemaining)
                                    pin = ""
                                    busy = false
                                }
                                is PinStore.VerifyResult.Locked -> {
                                    locked = true
                                    errorMessage = AuthStrings.pinLocked(locale)
                                    pin = ""
                                    busy = false
                                }
                                is PinStore.VerifyResult.Wiped -> {
                                    // 10 failures: wipe local secrets + session and force online login.
                                    wiped = true
                                    errorMessage = AuthStrings.pinWiped(locale)
                                    pin = ""
                                    pinStore.clear()
                                    repository.logout()
                                    busy = false
                                }
                                is PinStore.VerifyResult.NoPinSet -> {
                                    setupMode = true
                                    busy = false
                                }
                            }
                        }
                    }
                },
                enabled = inputsEnabled && pin.length == PinStore.PIN_LENGTH &&
                    (!isSetup || confirmPin.length == PinStore.PIN_LENGTH),
                modifier = Modifier.testTag("offline_pin_submit_btn"),
            )

            if (locked || wiped) {
                Spacer(Modifier.height(4.dp))
                TextButton(
                    onClick = { scope.launch { repository.logout() } },
                    modifier = Modifier
                        .align(Alignment.CenterHorizontally)
                        .testTag("offline_pin_signout_btn"),
                ) { Text(AuthStrings.signOut(locale), color = BentoTextSecondary) }
            }
        }
    }
}
