package com.fleetpulse.app.ui.admin

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController
import com.fleetpulse.app.data.TrackerLiveness
import com.fleetpulse.app.data.repo.FleetRepository
import com.fleetpulse.app.ui.components.EmptyState
import com.fleetpulse.app.ui.components.FleetButton
import com.fleetpulse.app.ui.components.SectionCard
import com.fleetpulse.app.ui.components.StatusChip
import com.fleetpulse.app.ui.theme.*

private val TRACKER_BRANDS = listOf(
    "GENERIC_H02", "TELTONIKA", "QUECLINK", "JIMI", "TK_STAR", "CALE", "SINTRONES",
)

@Composable
fun HardwareProvisioningScreen(repository: FleetRepository, locale: String, nav: NavController) {
    val devices by repository.hardwareDevices.collectAsState()
    val vehicles by repository.vehicles.collectAsState()
    val scope = rememberCoroutineScope()
    var showPair by remember { mutableStateOf(false) }
    var status by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(Unit) { repository.loadHardwareData() }

    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp)) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Text(t(locale, "hw.title"), style = MaterialTheme.typography.titleMedium, color = BentoTextPrimary, modifier = Modifier.weight(1f))
            Button(onClick = { showPair = true }, colors = ButtonDefaults.buttonColors(containerColor = BentoBluePrimary), modifier = Modifier.testTag("hw_pair_new")) {
                Icon(Icons.Filled.Add, contentDescription = null); Spacer(Modifier.width(6.dp)); Text("Pair tracker")
            }
        }
        status?.let { Text(it, color = StatusSafe, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(top = 8.dp)) }

        Spacer(Modifier.height(12.dp))
        Text(t(locale, "hw.liveness"), style = MaterialTheme.typography.bodySmall, color = BentoTextSecondary)

        if (devices.isEmpty()) {
            Spacer(Modifier.height(24.dp))
            EmptyState(icon = Icons.Filled.Memory, title = t(locale, "hw.emptyTitle"), message = t(locale, "hw.emptyMessage"))
        } else {
            devices.forEach { d ->
                val color = when (d.status) {
                    TrackerLiveness.ONLINE -> StatusSafe
                    TrackerLiveness.PENDING -> StatusWarning
                    TrackerLiveness.OFFLINE -> BentoTextSecondary
                    TrackerLiveness.LOST -> StatusDanger
                }
                SectionCard(modifier = Modifier.padding(vertical = 6.dp).testTag("hw_row_${d.deviceId}")) {
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text(d.vehiclePlate ?: "Unassigned", style = MaterialTheme.typography.bodyLarge, color = BentoTextPrimary, fontWeight = FontWeight.SemiBold)
                            Text("IMEI ${d.deviceId} · ${d.brand ?: "—"}", style = MaterialTheme.typography.bodySmall, color = BentoTextSecondary)
                        }
                        StatusChip(text = d.status.name, color = color)
                    }
                    Spacer(Modifier.height(8.dp))
                    val vehicleId = d.vehicleId ?: vehicles.firstOrNull { it.plateNumber == d.vehiclePlate }?.id
                    if (vehicleId != null) {
                        var busy by remember { mutableStateOf(false) }
                        OutlinedButton(
                            onClick = {
                                busy = true
                                scope.launch {
                                    val res = repository.unpairTracker(vehicleId)
                                    busy = false
                                    status = res.fold(
                                        onSuccess = { it.message.ifBlank { "Tracker unpaired." } },
                                        onFailure = { errorCopy((it as? com.fleetpulse.app.data.remote.AppException)?.errorCode ?: "UNKNOWN", locale) },
                                    )
                                    repository.loadHardwareData()
                                }
                            },
                            enabled = !busy,
                            colors = ButtonDefaults.outlinedButtonColors(contentColor = StatusDanger),
                            modifier = Modifier.testTag("hw_unpair_${d.deviceId}"),
                        ) {
                            if (busy) CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp) else Icon(Icons.Filled.LinkOff, contentDescription = null)
                            Spacer(Modifier.width(6.dp)); Text("Unpair")
                        }
                    } else {
                        Text(
                            "Paired · vehicle id not available to unpair",
                            style = MaterialTheme.typography.bodySmall,
                            color = BentoTextSecondary,
                        )
                    }
                }
            }
        }
    }

    if (showPair) {
        PairTrackerDialog(
            repository = repository,
            vehicles = vehicles.map { it.id to it.plateNumber }.toMap(),
            locale = locale,
            onDismiss = { showPair = false },
            onDone = { msg -> status = msg; showPair = false; scope.launch { repository.loadHardwareData() } },
            onError = { code -> status = errorCopy(code, locale) },
        )
    }
}

@Composable
private fun PairTrackerDialog(
    repository: FleetRepository,
    vehicles: Map<String, String>,
    locale: String,
    onDismiss: () -> Unit,
    onDone: (String) -> Unit,
    onError: (String) -> Unit,
) {
    var imei by remember { mutableStateOf("") }
    var brand by remember { mutableStateOf(TRACKER_BRANDS.first()) }
    var brandExpanded by remember { mutableStateOf(false) }
    var sim by remember { mutableStateOf("") }
    var vehicleId by remember { mutableStateOf(vehicles.keys.firstOrNull() ?: "") }
    var vehicleExpanded by remember { mutableStateOf(false) }
    var sms by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    val imeiValid = imei.matches(Regex("^\\d{15}$"))

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(t(locale, "hw.pairTitle"), color = BentoTextPrimary) },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState())) {
                OutlinedTextField(
                    value = imei, onValueChange = { imei = it.filter { c -> c.isDigit() }.take(15) },
                    label = { Text("Tracker IMEI (15 digits)") }, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                    isError = imei.isNotEmpty() && !imeiValid, singleLine = true, modifier = Modifier.fillMaxWidth().testTag("hw_imei_input"),
                )
                Spacer(Modifier.height(8.dp))
                ExposedDropdownMenuBox(expanded = brandExpanded, onExpandedChange = { brandExpanded = it }, modifier = Modifier.testTag("hw_brand_dropdown")) {
                    OutlinedTextField(value = brand, onValueChange = {}, readOnly = true, label = { Text("Brand") },
                        trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = brandExpanded) }, modifier = Modifier.menuAnchor().fillMaxWidth())
                    ExposedDropdownMenu(expanded = brandExpanded, onDismissRequest = { brandExpanded = false }) {
                        TRACKER_BRANDS.forEach { b -> DropdownMenuItem(text = { Text(b) }, onClick = { brand = b; brandExpanded = false }) }
                    }
                }
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(value = sim, onValueChange = { sim = it }, label = { Text("SIM number (optional)") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                Spacer(Modifier.height(8.dp))
                if (vehicles.isNotEmpty()) {
                    ExposedDropdownMenuBox(expanded = vehicleExpanded, onExpandedChange = { vehicleExpanded = it }, modifier = Modifier.testTag("hw_vehicle_dropdown")) {
                        OutlinedTextField(value = vehicles[vehicleId] ?: "", onValueChange = {}, readOnly = true, label = { Text("Vehicle") },
                            trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = vehicleExpanded) }, modifier = Modifier.menuAnchor().fillMaxWidth())
                        ExposedDropdownMenu(expanded = vehicleExpanded, onDismissRequest = { vehicleExpanded = false }) {
                            vehicles.forEach { (id, plate) -> DropdownMenuItem(text = { Text(plate) }, onClick = { vehicleId = id; vehicleExpanded = false }) }
                        }
                    }
                } else {
                    Text(t(locale, "hw.noVehicles"), color = BentoTextSecondary, style = MaterialTheme.typography.bodySmall)
                }
                sms?.let {
                    Spacer(Modifier.height(12.dp))
                    Surface(color = BentoBluePrimaryContainer, shape = RoundedCornerShape(12.dp), modifier = Modifier.fillMaxWidth()) {
                        Column(Modifier.padding(12.dp)) {
                            Text("Send this SMS to the tracker SIM:", color = BentoTextPrimary, style = MaterialTheme.typography.bodySmall)
                            Spacer(Modifier.height(4.dp))
                            Text(it, color = BentoTextPrimary, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Bold)
                        }
                    }
                }
            }
        },
        confirmButton = {
            FleetButton(
                text = if (busy) t(locale, "common.loading") else t(locale, "hw.pairAction"),
                onClick = {
                    if (!imeiValid || vehicleId.isEmpty()) return@FleetButton
                    busy = true
                    scope.launch {
                        val res = repository.pairTracker(vehicleId, imei, brand, sim.ifBlank { null })
                        busy = false
                        res.onSuccess { r ->
                            sms = if (r.smsCommand.isNullOrBlank()) r.message else "${r.smsCommand}\n${r.message}"
                            onDone(r.message)
                        }.onFailure { e ->
                            onError((e as? com.fleetpulse.app.data.remote.AppException)?.errorCode ?: "UNKNOWN")
                        }
                    }
                },
                enabled = imeiValid && vehicleId.isNotEmpty() && !busy,
                modifier = Modifier.testTag("hw_pair_confirm"),
            )
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text(t(locale, "common.cancel")) } },
    )
}
