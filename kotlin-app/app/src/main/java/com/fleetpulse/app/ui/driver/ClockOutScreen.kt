package com.fleetpulse.app.ui.driver

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController
import com.fleetpulse.app.data.FuelGaugeLevel
import com.fleetpulse.app.data.repo.FleetRepository
import com.fleetpulse.app.ui.components.SectionCard
import com.fleetpulse.app.ui.theme.*
import kotlinx.coroutines.launch

@Composable
fun ClockOutScreen(repository: FleetRepository, nav: NavController, locale: String) {
    val shift by repository.activeShift.collectAsState()
    val scope = rememberCoroutineScope()
    var odometer by remember { mutableStateOf("") }
    var gauge by remember { mutableStateOf(FuelGaugeLevel.HALF) }
    var notes by remember { mutableStateOf("") }
    var photo by remember { mutableStateOf<CapturedPhoto?>(null) }
    var localError by remember { mutableStateOf<String?>(null) }
    var submitting by remember { mutableStateOf(false) }

    Column(modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp)) {
        BackButton({ nav.popBackStack() }, locale)
        Spacer(Modifier.height(8.dp))
        ScreenTitle(t(locale, "home.clockOut"))

        if (shift == null) {
            Spacer(Modifier.height(16.dp))
            Text(t(locale, "home.noActiveShift"), color = StatusWarning, style = MaterialTheme.typography.bodyMedium)
        }

        Spacer(Modifier.height(16.dp))
        SectionCard {
            OutlinedTextField(
                value = odometer, onValueChange = { odometer = it.filter { c -> c.isDigit() } },
                label = { Text("End odometer (km)") }, modifier = Modifier.fillMaxWidth().testTag("clockout_odometer"),
                singleLine = true, colors = driverFieldColors(),
            )
            Spacer(Modifier.height(12.dp))
            Text("End fuel gauge", style = MaterialTheme.typography.bodyMedium, color = BentoTextSecondary)
            Spacer(Modifier.height(6.dp))
            GaugeSelector(gauge, { gauge = it }, "clockout_gauge")
            Spacer(Modifier.height(12.dp))
            OutlinedTextField(
                value = notes, onValueChange = { notes = it },
                label = { Text("Debrief notes (optional)") }, modifier = Modifier.fillMaxWidth().testTag("clockout_notes"),
                minLines = 2, colors = driverFieldColors(),
            )
        }

        Spacer(Modifier.height(16.dp))
        PhotoCaptureField(label = "End photo", required = true, photo = photo, onCapture = { photo = it }, testTag = "clockout_photo")

        if (localError != null) {
            Spacer(Modifier.height(8.dp))
            Text(localError!!, color = StatusDanger, style = MaterialTheme.typography.bodyMedium)
        }

        Spacer(Modifier.height(20.dp))
        Button(
            onClick = {
                val km = odometer.toLongOrNull()
                when {
                    shift == null -> localError = t(locale, "home.noActiveShift")
                    km == null || km < 0 -> localError = "Enter a valid odometer reading"
                    photo == null -> localError = "An end photo is required"
                    else -> {
                        localError = null
                        submitting = true
                        scope.launch {
                            val mediaId = repository.uploadMedia("WORK_LOG", "WORK_PLAN", photo!!.contentType, photo!!.bytes)
                            if (mediaId != null) {
                                repository.clockOut(shift!!.id, km, gauge.name, mediaId)
                                nav.navigate("home") { popUpTo("home") { inclusive = true } }
                            } else {
                                localError = "Photo upload failed — will retry when online"
                                submitting = false
                            }
                        }
                    }
                }
            },
            enabled = !submitting,
            modifier = Modifier.fillMaxWidth().height(52.dp).testTag("clock_out_submit"),
            colors = ButtonDefaults.buttonColors(containerColor = BentoPurplePrimary),
        ) {
            Text(if (submitting) t(locale, "common.pending") else t(locale, "home.clockOut"))
        }
    }
}
