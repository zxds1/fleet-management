package com.fleetpulse.app.ui.admin

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController
import com.fleetpulse.app.data.remote.VehicleCreateRequest
import com.fleetpulse.app.data.remote.VehicleUpdateRequest
import com.fleetpulse.app.data.AppConstants
import com.fleetpulse.app.data.repo.FleetRepository
import com.fleetpulse.app.ui.components.EmptyState
import com.fleetpulse.app.ui.components.FleetButton
import com.fleetpulse.app.ui.theme.*

@Composable
fun VehicleManagementScreen(repository: FleetRepository, locale: String, nav: NavController) {
    val vehicles by repository.vehicleMaster.collectAsState()
    val scope = rememberCoroutineScope()
    var showCreate by remember { mutableStateOf(false) }
    var status by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(Unit) { repository.loadVehicleMaster() }

    Column(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth().padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("Vehicle Master", style = MaterialTheme.typography.titleLarge, color = BentoTextPrimary, modifier = Modifier.weight(1f))
            Button(onClick = { showCreate = true }, colors = ButtonDefaults.buttonColors(containerColor = BentoBluePrimary)) {
                Icon(Icons.Filled.Add, null); Spacer(Modifier.width(6.dp)); Text("Add vehicle")
            }
        }
        status?.let { Text(it, color = StatusSafe, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(horizontal = 16.dp)) }
        if (vehicles.isEmpty()) {
            Box(Modifier.fillMaxSize(), contentAlignment = androidx.compose.ui.Alignment.Center) {
                EmptyState(icon = Icons.Filled.DirectionsCar, title = "No vehicles", message = "Provision vehicles for your fleet here.")
            }
        } else {
            AdminListScaffold(locale, Icons.Filled.DirectionsCar, "No vehicles", "", isEmpty = false) {
                items(vehicles, key = { it.id }) { v ->
                    Surface(color = BentoCardBg, shape = RoundedCornerShape(16.dp), border = BorderStroke(1.dp, BentoBorder),
                        modifier = Modifier.fillMaxWidth().clickable { nav.navigate("vehicle_master/${v.id}") }.testTag("vehicle_master_row_${v.id}")) {
                        Column(Modifier.padding(16.dp)) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Text(v.plateNumber, style = MaterialTheme.typography.bodyLarge, color = BentoTextPrimary, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
                                StatusChip(text = v.status, color = if (v.isOperational) StatusSafe else StatusWarning)
                            }
                            Text("${v.make ?: ""} ${v.model ?: ""} · ${v.vehicleClass}${v.year?.let { " · $it" } ?: ""}", style = MaterialTheme.typography.bodySmall, color = BentoTextSecondary)
                        }
                    }
                }
            }
        }
    }

    if (showCreate) {
        CreateVehicleDialog(
            onDismiss = { showCreate = false },
            onDone = { msg -> status = msg; showCreate = false; scope.launch { repository.loadVehicleMaster() } },
            onError = { code -> status = errorCopy(code, locale) },
            repository = repository,
        )
    }
}

@Composable
private fun CreateVehicleDialog(
    repository: FleetRepository,
    onDismiss: () -> Unit,
    onDone: (String) -> Unit,
    onError: (String) -> Unit,
) {
    var plate by remember { mutableStateOf("") }
    var make by remember { mutableStateOf("") }
    var model by remember { mutableStateOf("") }
    var year by remember { mutableStateOf("") }
    var vehClass by remember { mutableStateOf("RIGID") }
    var classExpanded by remember { mutableStateOf(false) }
    val classes = AppConstants.VEHICLE_CLASSES
    var busy by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Add vehicle", color = BentoTextPrimary) },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState())) {
                OutlinedTextField(value = plate, onValueChange = { plate = it }, label = { Text("License plate") }, singleLine = true, modifier = Modifier.fillMaxWidth().testTag("vm_plate"))
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(value = make, onValueChange = { make = it }, label = { Text("Make (optional)") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(value = model, onValueChange = { model = it }, label = { Text("Model (optional)") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(value = year, onValueChange = { year = it.filter { c -> c.isDigit() }.take(4) }, label = { Text("Year (optional)") }, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number), singleLine = true, modifier = Modifier.fillMaxWidth())
                Spacer(Modifier.height(8.dp))
                ExposedDropdownMenuBox(expanded = classExpanded, onExpandedChange = { classExpanded = it }, modifier = Modifier.testTag("vm_class_dropdown")) {
                    OutlinedTextField(value = vehClass, onValueChange = {}, readOnly = true, label = { Text("Class") }, modifier = Modifier.menuAnchor().fillMaxWidth())
                    ExposedDropdownMenu(expanded = classExpanded, onDismissRequest = { classExpanded = false }) {
                        classes.forEach { c -> DropdownMenuItem(text = { Text(c) }, onClick = { vehClass = c; classExpanded = false }) }
                    }
                }
            }
        },
        confirmButton = {
            FleetButton(
                text = if (busy) "Saving..." else "Create",
                onClick = {
                    if (plate.isBlank()) return@FleetButton
                    busy = true
                    scope.launch {
                        val res = repository.createVehicle(
                            VehicleCreateRequest(
                                license_plate = plate.trim(),
                                vehicle_class = vehClass,
                                make = make.ifBlank { null },
                                model = model.ifBlank { null },
                                year = year.toIntOrNull(),
                            ),
                        )
                        busy = false
                        res.onSuccess { onDone("Vehicle $plate added.") }
                            .onFailure { e -> onError((e as? com.fleetpulse.app.data.remote.AppException)?.errorCode ?: "UNKNOWN") }
                    }
                },
                enabled = plate.isNotBlank() && !busy,
                modifier = Modifier.testTag("vm_create_confirm"),
            )
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}
