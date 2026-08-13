package com.fleetpulse.app.ui.admin

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController
import com.fleetpulse.app.data.repo.FleetRepository
import com.fleetpulse.app.ui.components.FleetButton
import com.fleetpulse.app.ui.theme.*
import kotlinx.coroutines.launch

@Composable
fun AdminManagementScreen(repository: FleetRepository, locale: String, nav: NavController) {
    val principal by repository.principal.collectAsState()
    val scope = rememberCoroutineScope()
    var showInvite by remember { mutableStateOf(false) }
    var showNewDriver by remember { mutableStateOf(false) }
    var status by remember { mutableStateOf<String?>(null) }
    Column(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Text("Admin & Tenant", style = MaterialTheme.typography.titleLarge, color = BentoTextPrimary, modifier = Modifier.weight(1f))
            Button(onClick = { showInvite = true }, colors = ButtonDefaults.buttonColors(containerColor = BentoPurplePrimary), modifier = Modifier.testTag("invite_user")) { Icon(Icons.Filled.PersonAdd, null); Spacer(Modifier.width(6.dp)); Text("Invite") }
            Spacer(Modifier.width(8.dp))
            OutlinedButton(onClick = { showNewDriver = true }, modifier = Modifier.testTag("new_driver")) { Icon(Icons.Filled.PersonAddAlt1, null); Spacer(Modifier.width(6.dp)); Text("New driver") }
        }
        status?.let { Text(it, color = StatusSafe, style = MaterialTheme.typography.bodySmall) }
        AdminRowCard(title = "Users", subtitle = "Tenant users, roles & scope", onClick = { nav.navigate("users") })
        AdminRowCard(title = "Drivers", subtitle = "Roster, MFA, suspend / reinstate", onClick = { nav.navigate("drivers") })
        AdminRowCard(title = "Vehicles", subtitle = "Master list, status, assignment", onClick = { nav.navigate("vehicles") })
        AdminRowCard(title = "Hardware", subtitle = "Provision / unpair trackers", onClick = { nav.navigate("hardware") })
        AdminRowCard(title = "Trailer swap", subtitle = "Hook / drop trailers", onClick = { nav.navigate("trailer") })
        AdminRowCard(title = "Maintenance", subtitle = "Work orders", onClick = { nav.navigate("maintenance") })
        AdminRowCard(title = "Data requests", subtitle = "DSAR export / deletion", onClick = { nav.navigate("privacy") })
        AdminRowCard(title = "Alert triggers", subtitle = "Speed / fuel thresholds", onClick = { nav.navigate("triggers") })
        AdminRowCard(title = "Expiring docs", subtitle = "Licences / road tax", onClick = { nav.navigate("expiring_docs") })
        AdminRowCard(title = "My profile", subtitle = principal?.email ?: "—", onClick = { nav.navigate("profile") })
    }

    if (showInvite) {
        var email by remember { mutableStateOf("") }
        var role by remember { mutableStateOf("FLEET_MANAGER") }
        var roleExpanded by remember { mutableStateOf(false) }
        // Backend InviteUserSchema only allows these two roles.
        val roles = listOf("FLEET_MANAGER", "ADMIN")
        AlertDialog(onDismissRequest = { showInvite = false }, title = { Text("Invite user") },
            text = {
                Column(Modifier.verticalScroll(rememberScrollState())) {
                    OutlinedTextField(value = email, onValueChange = { email = it }, label = { Text("Email") }, singleLine = true, modifier = Modifier.fillMaxWidth().testTag("invite_email"))
                    Spacer(Modifier.height(8.dp))
                    ExposedDropdownMenuBox(expanded = roleExpanded, onExpandedChange = { roleExpanded = it }) {
                        OutlinedTextField(value = role, onValueChange = {}, readOnly = true, label = { Text("Role") }, modifier = Modifier.menuAnchor().fillMaxWidth().testTag("invite_role"))
                        ExposedDropdownMenu(expanded = roleExpanded, onDismissRequest = { roleExpanded = false }) {
                            roles.forEach { r -> DropdownMenuItem(text = { Text(r) }, onClick = { role = r; roleExpanded = false }) }
                        }
                    }
                }
            },
            confirmButton = {
                FleetButton(text = "Send invite", onClick = {
                    if (email.isBlank()) return@FleetButton
                    showInvite = false
                    scope.launch { repository.inviteUser(email.trim(), role).onSuccess { status = "Invite sent to $email." }.onFailure { status = errorCopy((it as? com.fleetpulse.app.data.remote.AppException)?.errorCode ?: "UNKNOWN", locale) } }
                }, modifier = Modifier.testTag("invite_confirm"))
            },
            dismissButton = { TextButton(onClick = { showInvite = false }) { Text("Cancel") } })
    }

    if (showNewDriver) {
        var email by remember { mutableStateOf("") }
        var fullName by remember { mutableStateOf("") }
        var phone by remember { mutableStateOf("") }
        var busy by remember { mutableStateOf(false) }
        AlertDialog(onDismissRequest = { showNewDriver = false }, title = { Text("New driver") },
            text = {
                Column(Modifier.verticalScroll(rememberScrollState())) {
                    OutlinedTextField(value = fullName, onValueChange = { fullName = it }, label = { Text("Full name") }, singleLine = true, modifier = Modifier.fillMaxWidth().testTag("driver_name"))
                    Spacer(Modifier.height(8.dp))
                    OutlinedTextField(value = email, onValueChange = { email = it }, label = { Text("Email") }, singleLine = true, modifier = Modifier.fillMaxWidth().testTag("driver_email"))
                    Spacer(Modifier.height(8.dp))
                    OutlinedTextField(value = phone, onValueChange = { phone = it }, label = { Text("Phone (optional)") }, singleLine = true, modifier = Modifier.fillMaxWidth().testTag("driver_phone"))
                }
            },
            confirmButton = {
                FleetButton(text = if (busy) "Creating..." else "Create", onClick = {
                    if (email.isBlank() || fullName.isBlank()) return@FleetButton
                    busy = true
                    scope.launch {
                        repository.createDriver(email.trim(), fullName.trim(), phone.ifBlank { null })
                            .onSuccess { status = "Driver $fullName created." }
                            .onFailure { status = errorCopy((it as? com.fleetpulse.app.data.remote.AppException)?.errorCode ?: "UNKNOWN", locale) }
                        busy = false
                        showNewDriver = false
                    }
                }, enabled = email.isNotBlank() && fullName.isNotBlank() && !busy, modifier = Modifier.testTag("driver_create_confirm"))
            },
            dismissButton = { TextButton(onClick = { showNewDriver = false }) { Text("Cancel") } })
    }
}
