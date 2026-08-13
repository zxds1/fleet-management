package com.fleetpulse.app.ui.admin

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController
import com.fleetpulse.app.data.repo.FleetRepository
import com.fleetpulse.app.ui.components.FleetButton
import com.fleetpulse.app.ui.theme.*
import kotlinx.coroutines.launch

@Composable
fun TrailerSwapScreen(repository: FleetRepository, locale: String, nav: NavController) {
    val vehicles by repository.vehicleMaster.collectAsState()
    val scope = rememberCoroutineScope()
    var trailerId by remember { mutableStateOf("") }
    var vehicleId by remember { mutableStateOf(vehicles.firstOrNull()?.id ?: "") }
    var vehicleExpanded by remember { mutableStateOf(false) }
    var odometer by remember { mutableStateOf("") }
    var status by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }

    LaunchedEffect(Unit) { repository.loadVehicleMaster() }

    Column(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text("Trailer Swap", style = MaterialTheme.typography.titleLarge, color = BentoTextPrimary)
        OutlinedTextField(value = trailerId, onValueChange = { trailerId = it }, label = { Text("Trailer ID") }, singleLine = true, modifier = Modifier.fillMaxWidth().testTag("trailer_id"))
        if (vehicles.isNotEmpty()) {
            ExposedDropdownMenuBox(expanded = vehicleExpanded, onExpandedChange = { vehicleExpanded = it }, modifier = Modifier.testTag("trailer_vehicle_dropdown")) {
                OutlinedTextField(value = vehicles.firstOrNull { it.id == vehicleId }?.plateNumber ?: "", onValueChange = {}, readOnly = true, label = { Text("Vehicle (optional)") }, modifier = Modifier.menuAnchor().fillMaxWidth())
                ExposedDropdownMenu(expanded = vehicleExpanded, onDismissRequest = { vehicleExpanded = false }) {
                    vehicles.forEach { v -> DropdownMenuItem(text = { Text(v.plateNumber) }, onClick = { vehicleId = v.id; vehicleExpanded = false }) }
                }
            }
        }
        OutlinedTextField(value = odometer, onValueChange = { odometer = it.filter { c -> c.isDigit() } }, label = { Text("Odometer km (optional)") }, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number), singleLine = true, modifier = Modifier.fillMaxWidth().testTag("trailer_odometer"))
        status?.let { Text(it, color = StatusSafe, style = MaterialTheme.typography.bodySmall) }
        FleetButton(
            text = if (busy) "Swapping..." else "Swap / Hook",
            onClick = {
                if (trailerId.isBlank()) return@FleetButton
                busy = true
                scope.launch {
                    val res = repository.swapTrailer(trailerId.trim(), vehicleId.ifBlank { null }, odometer.toLongOrNull())
                    busy = false
                    res.onSuccess { r -> status = r.dropped_trailer_id?.let { "Dropped $it; " }.orEmpty() + "swap recorded." }
                        .onFailure { e -> status = errorCopy((e as? com.fleetpulse.app.data.remote.AppException)?.errorCode ?: "UNKNOWN", locale) }
                }
            },
            enabled = trailerId.isNotBlank() && !busy,
            modifier = Modifier.testTag("trailer_swap_confirm"),
        )
    }
}
