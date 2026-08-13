package com.fleetpulse.app.ui.admin

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController
import com.fleetpulse.app.data.*
import com.fleetpulse.app.data.repo.FleetRepository
import com.fleetpulse.app.ui.components.FleetButton
import com.fleetpulse.app.ui.components.StatusChip
import com.fleetpulse.app.ui.theme.*
import kotlinx.coroutines.launch

@Composable
fun UserDetailScreen(repository: FleetRepository, locale: String, userId: String, nav: NavController) {
    val users by repository.tenantUsers.collectAsState()
    val drivers by repository.driverRoster.collectAsState()
    val vehicles by repository.vehicleMaster.collectAsState()
    val scope = rememberCoroutineScope()
    val user = users.firstOrNull { it.id == userId }
    var statusField by remember { mutableStateOf<String?>(null) }

    val isManager = user?.roles?.any { it == "FLEET_MANAGER" || it == "ADMIN" } ?: false
    val selectedVehicleIds = remember { mutableStateListOf<String>() }
    val selectedDriverIds = remember { mutableStateListOf<String>() }

    LaunchedEffect(userId) {
        repository.loadTenantUsers()
        repository.loadTenantManagers()
        repository.loadDriverRosterData()
        repository.loadVehicleMaster()
    }

    if (user == null) {
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { Text("User not found", color = BentoTextSecondary) }
        return
    }

    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(user.fullName ?: user.email, style = MaterialTheme.typography.titleLarge, color = BentoTextPrimary)
        Row(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            StatusChip(text = user.status, color = if (user.status == "SUSPENDED") StatusDanger else StatusSafe)
            StatusChip(text = user.roles.firstOrNull() ?: "—", color = BentoPurplePrimary)
        }
        statusField?.let { Text(it, color = StatusSafe, style = MaterialTheme.typography.bodySmall) }

        // Roles + revoke
        Text("Roles", style = MaterialTheme.typography.titleMedium, color = BentoTextPrimary)
        if (user.roles.isEmpty()) {
            Text("No roles assigned.", style = MaterialTheme.typography.bodySmall, color = BentoTextSecondary)
        } else {
            LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                items(user.roles) { role ->
                    AssistChip(
                        onClick = {
                            scope.launch {
                                repository.revokeRole(user.id, role)
                                    .onSuccess { statusField = "Revoked $role." }
                                    .onFailure { e -> statusField = errorCopy((e as? com.fleetpulse.app.data.remote.AppException)?.errorCode ?: "UNKNOWN", locale) }
                            }
                        },
                        label = { Text(role) },
                        modifier = Modifier.testTag("revoke_role_$role"),
                        trailingIcon = { Icon(Icons.Filled.Close, null, tint = StatusDanger) },
                        colors = AssistChipDefaults.assistChipColors(containerColor = BentoCardBg, labelColor = BentoTextPrimary),
                    )
                }
            }
        }

        // Manager scope assignment
        if (isManager) {
            Text("Manager scope", style = MaterialTheme.typography.titleMedium, color = BentoTextPrimary)
            Text("Vehicles", style = MaterialTheme.typography.bodyMedium, color = BentoTextSecondary)
            LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                items(vehicles, key = { it.id }) { v ->
                    val selected = selectedVehicleIds.contains(v.id)
                    FilterChip(
                        selected = selected,
                        onClick = { if (selected) selectedVehicleIds.remove(v.id) else selectedVehicleIds.add(v.id) },
                        label = { Text(v.plateNumber) },
                        modifier = Modifier.testTag("scope_vehicle_${v.id}"),
                        colors = FilterChipDefaults.filterChipColors(
                            selectedContainerColor = BentoPurpleContainer, selectedLabelColor = BentoTextPrimary,
                            containerColor = BentoCardBg, labelColor = BentoTextSecondary,
                        ),
                    )
                }
            }
            Text("Drivers", style = MaterialTheme.typography.bodyMedium, color = BentoTextSecondary)
            LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                items(drivers, key = { it.id }) { d ->
                    val selected = selectedDriverIds.contains(d.id)
                    FilterChip(
                        selected = selected,
                        onClick = { if (selected) selectedDriverIds.remove(d.id) else selectedDriverIds.add(d.id) },
                        label = { Text(d.name) },
                        modifier = Modifier.testTag("scope_driver_${d.id}"),
                        colors = FilterChipDefaults.filterChipColors(
                            selectedContainerColor = BentoPurpleContainer, selectedLabelColor = BentoTextPrimary,
                            containerColor = BentoCardBg, labelColor = BentoTextSecondary,
                        ),
                    )
                }
            }
            FleetButton(
                text = "Save scope",
                onClick = {
                    scope.launch {
                        repository.assignManagerScope(user.id, selectedVehicleIds.toList(), selectedDriverIds.toList())
                            .onSuccess { statusField = "Scope saved." }
                            .onFailure { e -> statusField = errorCopy((e as? com.fleetpulse.app.data.remote.AppException)?.errorCode ?: "UNKNOWN", locale) }
                    }
                },
                modifier = Modifier.testTag("save_scope"),
            )
        }

        // Lifecycle
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            if (user.status != "SUSPENDED") {
                OutlinedButton(onClick = {
                    scope.launch { repository.suspendUser(user.id).onSuccess { statusField = "User suspended." }.onFailure { e -> statusField = errorCopy((e as? com.fleetpulse.app.data.remote.AppException)?.errorCode ?: "UNKNOWN", locale) } }
                }, colors = ButtonDefaults.outlinedButtonColors(contentColor = StatusDanger), modifier = Modifier.testTag("suspend_user")) { Text("Suspend") }
            } else {
                OutlinedButton(onClick = {
                    scope.launch { repository.reinstateUser(user.id).onSuccess { statusField = "User reinstated." }.onFailure { e -> statusField = errorCopy((e as? com.fleetpulse.app.data.remote.AppException)?.errorCode ?: "UNKNOWN", locale) } }
                }, modifier = Modifier.testTag("reinstate_user")) { Text("Reinstate") }
            }
        }
    }
}
