package com.fleetpulse.app.ui.admin

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController
import com.fleetpulse.app.data.*
import com.fleetpulse.app.data.remote.VehicleUpdateRequest
import com.fleetpulse.app.data.repo.FleetRepository
import com.fleetpulse.app.ui.components.FleetButton
import com.fleetpulse.app.ui.components.StatusChip
import com.fleetpulse.app.ui.theme.*
import kotlinx.coroutines.launch

@Composable
fun VehicleMasterDetailScreen(repository: FleetRepository, locale: String, vehicleId: String, nav: NavController) {
    val vehicles by repository.vehicleMaster.collectAsState()
    val drivers by repository.driverRoster.collectAsState()
    val scope = rememberCoroutineScope()
    val vehicle = vehicles.firstOrNull { it.id == vehicleId }
    var statusField by remember { mutableStateOf<String?>(null) }
    var notes by remember { mutableStateOf(vehicle?.notes ?: "") }
    var status by remember { mutableStateOf(vehicle?.status ?: "AVAILABLE") }
    var statusExpanded by remember { mutableStateOf(false) }
    val statuses = listOf("AVAILABLE", "IN_USE", "MAINTENANCE", "QUARANTINED", "RETIRED", "EXTERNAL")
    val assignedDriverIds = remember { mutableStateListOf<String>() }

    LaunchedEffect(vehicleId) {
        repository.loadVehicleMaster()
        repository.loadDriverRosterData()
    }

    if (vehicle == null) {
        Box(Modifier.fillMaxSize(), contentAlignment = androidx.compose.ui.Alignment.Center) {
            Text("Vehicle not found", color = BentoTextSecondary)
        }
        return
    }

    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(vehicle.plateNumber, style = MaterialTheme.typography.titleLarge, color = BentoTextPrimary, modifier = Modifier.weight(1f))
            StatusChip(text = vehicle.status, color = if (vehicle.isOperational) StatusSafe else StatusWarning)
        }
        Text("${vehicle.make ?: ""} ${vehicle.model ?: ""} · ${vehicle.vehicleClass}${vehicle.year?.let { " · $it" } ?: ""}", style = MaterialTheme.typography.bodyMedium, color = BentoTextSecondary)
        statusField?.let { Text(it, color = StatusSafe, style = MaterialTheme.typography.bodySmall) }

        OutlinedTextField(value = notes, onValueChange = { notes = it }, label = { Text("Notes") }, modifier = Modifier.fillMaxWidth())
        ExposedDropdownMenuBox(expanded = statusExpanded, onExpandedChange = { statusExpanded = it }) {
            OutlinedTextField(value = status, onValueChange = {}, readOnly = true, label = { Text("Status") }, modifier = Modifier.menuAnchor().fillMaxWidth())
            ExposedDropdownMenu(expanded = statusExpanded, onDismissRequest = { statusExpanded = false }) {
                statuses.forEach { s -> DropdownMenuItem(text = { Text(s) }, onClick = { status = s; statusExpanded = false }) }
            }
        }

        Text("Assigned drivers", style = MaterialTheme.typography.titleMedium, color = BentoTextPrimary)
        if (drivers.isEmpty()) {
            Text("No drivers available to assign.", style = MaterialTheme.typography.bodySmall, color = BentoTextSecondary)
        } else {
            LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                items(drivers, key = { it.id }) { d ->
                    val selected = assignedDriverIds.contains(d.id)
                    FilterChip(
                        selected = selected,
                        onClick = { if (selected) assignedDriverIds.remove(d.id) else assignedDriverIds.add(d.id) },
                        label = { Text(d.name) },
                        modifier = Modifier.testTag("driver_chip_${d.id}"),
                        colors = FilterChipDefaults.filterChipColors(
                            selectedContainerColor = BentoPurpleContainer,
                            selectedLabelColor = BentoTextPrimary,
                            containerColor = BentoCardBg,
                            labelColor = BentoTextSecondary,
                        ),
                    )
                }
            }
        }
        FleetButton(
            text = "Save assignment",
            onClick = {
                scope.launch {
                    repository.assignVehicle(vehicle.id, assignedDriverIds.toList())
                        .onSuccess { statusField = "Assignment saved." }
                        .onFailure { e -> statusField = errorCopy((e as? com.fleetpulse.app.data.remote.AppException)?.errorCode ?: "UNKNOWN", locale) }
                }
            },
            modifier = Modifier.testTag("vehicle_assign_save"),
        )

        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Button(onClick = {
                scope.launch {
                    val res = repository.updateVehicle(vehicle.id, VehicleUpdateRequest(status = status, notes = notes.ifBlank { null }))
                    res.onSuccess { statusField = "Saved." }.onFailure { e -> statusField = errorCopy((e as? com.fleetpulse.app.data.remote.AppException)?.errorCode ?: "UNKNOWN", locale) }
                }
            }, colors = ButtonDefaults.buttonColors(containerColor = BentoPurplePrimary), modifier = Modifier.testTag("vm_save")) {
                Icon(Icons.Filled.Save, null); Spacer(Modifier.width(6.dp)); Text("Save")
            }
        }
    }
}
