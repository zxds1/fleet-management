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
import com.fleetpulse.app.data.repo.FleetRepository
import com.fleetpulse.app.ui.components.SectionCard
import com.fleetpulse.app.ui.theme.*
import kotlinx.coroutines.launch
import java.time.Instant

@Composable
fun RefuelScreen(repository: FleetRepository, nav: NavController, locale: String) {
    val shift by repository.activeShift.collectAsState()
    val vehicles by repository.vehicles.collectAsState()
    val scope = rememberCoroutineScope()

    var receipt by remember { mutableStateOf<CapturedPhoto?>(null) }
    var odometerPhoto by remember { mutableStateOf<CapturedPhoto?>(null) }
    var odometer by remember { mutableStateOf("") }
    var cardLast4 by remember { mutableStateOf("") }
    var localError by remember { mutableStateOf<String?>(null) }
    var submitting by remember { mutableStateOf(false) }
    var done by remember { mutableStateOf(false) }

    val vehicleId = shift?.vehicleId ?: vehicles.firstOrNull()?.id

    if (done) {
        Column(modifier = Modifier.fillMaxSize().padding(32.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
            Icon(Icons.Filled.CheckCircle, contentDescription = null, tint = StatusSafe, modifier = Modifier.size(64.dp))
            Spacer(Modifier.height(16.dp))
            Text("Refuel queued", style = MaterialTheme.typography.titleLarge, color = BentoTextPrimary)
            Spacer(Modifier.height(16.dp))
            Button(onClick = { nav.popBackStack() }, colors = ButtonDefaults.buttonColors(containerColor = BentoBluePrimary), modifier = Modifier.testTag("refuel_done")) {
                Text(t(locale, "common.back"))
            }
        }
        return
    }

    Column(modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp)) {
        BackButton({ nav.popBackStack() }, locale)
        Spacer(Modifier.height(8.dp))
        ScreenTitle(t(locale, "tabs.refuel"))

        Spacer(Modifier.height(16.dp))
        PhotoCaptureField(label = "Receipt photo", required = true, photo = receipt, onCapture = { receipt = it }, testTag = "refuel_receipt")
        Spacer(Modifier.height(16.dp))
        PhotoCaptureField(label = "Odometer photo", required = true, photo = odometerPhoto, onCapture = { odometerPhoto = it }, testTag = "refuel_odometer_photo")

        Spacer(Modifier.height(16.dp))
        SectionCard {
            OutlinedTextField(
                value = odometer, onValueChange = { odometer = it.filter { c -> c.isDigit() } },
                label = { Text("Odometer reading (km)") }, modifier = Modifier.fillMaxWidth().testTag("refuel_odometer"),
                singleLine = true, colors = driverFieldColors(),
            )
            Spacer(Modifier.height(12.dp))
            OutlinedTextField(
                value = cardLast4, onValueChange = { cardLast4 = it.filter { c -> c.isDigit() }.take(4) },
                label = { Text("Fuel card last 4 (optional)") }, modifier = Modifier.fillMaxWidth().testTag("refuel_card"),
                singleLine = true, colors = driverFieldColors(),
            )
        }

        if (localError != null) {
            Spacer(Modifier.height(8.dp))
            Text(localError!!, color = StatusDanger, style = MaterialTheme.typography.bodyMedium)
        }

        Spacer(Modifier.height(20.dp))
        Button(
            onClick = {
                val km = odometer.toLongOrNull()
                when {
                    receipt == null || odometerPhoto == null -> localError = "Both photos are required"
                    km == null || km < 0 -> localError = "Enter a valid odometer reading"
                    else -> {
                        localError = null
                        submitting = true
                        scope.launch {
                            val rId = repository.uploadMedia("FUEL_RECEIPT", "FUEL_RECEIPT", receipt!!.contentType, receipt!!.bytes)
                            val oId = repository.uploadMedia("FUEL_DASHBOARD", "FUEL_RECEIPT", odometerPhoto!!.contentType, odometerPhoto!!.bytes)
                            if (rId != null && oId != null && vehicleId != null) {
                                repository.submitRefuel(
                                    vehicleId, shift?.id, km, rId, oId,
                                    Instant.now().toString(), cardLast4.ifBlank { null },
                                )
                                done = true
                            } else {
                                localError = "Upload failed — will retry when online"
                                submitting = false
                            }
                        }
                    }
                }
            },
            enabled = !submitting,
            modifier = Modifier.fillMaxWidth().height(52.dp).testTag("refuel_submit"),
            colors = ButtonDefaults.buttonColors(containerColor = BentoBluePrimary),
        ) {
            Text(if (submitting) t(locale, "common.pending") else t(locale, "tabs.refuel"))
        }
    }
}
