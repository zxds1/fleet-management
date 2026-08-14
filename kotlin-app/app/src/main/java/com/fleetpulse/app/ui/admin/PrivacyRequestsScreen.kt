package com.fleetpulse.app.ui.admin

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController
import com.fleetpulse.app.data.repo.FleetRepository
import com.fleetpulse.app.ui.components.EmptyState
import com.fleetpulse.app.ui.components.FleetButton
import com.fleetpulse.app.ui.theme.*

@Composable
fun PrivacyRequestsScreen(repository: FleetRepository, locale: String, nav: NavController) {
    val requests by repository.privacyRequests.collectAsState()
    val scope = rememberCoroutineScope()
    var status by remember { mutableStateOf<String?>(null) }
    var showExport by remember { mutableStateOf(false) }
    var showDelete by remember { mutableStateOf(false) }

    LaunchedEffect(Unit) { repository.loadPrivacyRequests() }

    Column(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth().padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("Data Requests", style = MaterialTheme.typography.titleLarge, color = BentoTextPrimary, modifier = Modifier.weight(1f))
            OutlinedButton(onClick = { showExport = true }) { Icon(Icons.Filled.Download, null); Spacer(Modifier.width(6.dp)); Text("Export") }
            Spacer(Modifier.width(8.dp))
            OutlinedButton(onClick = { showDelete = true }, colors = ButtonDefaults.outlinedButtonColors(contentColor = StatusDanger)) { Icon(Icons.Filled.Delete, null); Spacer(Modifier.width(6.dp)); Text("Delete") }
        }
        status?.let { Text(it, color = StatusSafe, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(horizontal = 16.dp)) }

        if (requests.isEmpty()) {
            Box(Modifier.fillMaxSize(), contentAlignment = androidx.compose.ui.Alignment.Center) {
                EmptyState(icon = Icons.Filled.Shield, title = "No data requests", message = "GDPR / Kenya DPA DSAR requests appear here.")
            }
        } else {
            AdminListScaffold(locale, Icons.Filled.Shield, "No data requests", "", isEmpty = false) {
                items(requests, key = { it.id }) { r ->
                    val color = when (r.status) {
                        "READY", "COMPLETED" -> StatusSafe
                        "FAILED" -> StatusDanger
                        "PENDING", "PROCESSING" -> StatusWarning
                        else -> BentoTextSecondary
                    }
                    Surface(color = BentoCardBg, shape = RoundedCornerShape(16.dp), border = BorderStroke(1.dp, BentoBorder), modifier = Modifier.fillMaxWidth().testTag("privacy_row_${r.id}")) {
                        Column(Modifier.padding(16.dp)) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Text("${r.requestType} · ${r.requesterEmail ?: "—"}", style = MaterialTheme.typography.bodyLarge, color = BentoTextPrimary, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
                                StatusChip(text = r.status, color = color)
                            }
                            r.downloadUrl?.let {
                                Spacer(Modifier.height(8.dp))
                                Text(it, style = MaterialTheme.typography.bodySmall, color = BentoBluePrimary, modifier = Modifier.clickable { /* open download */ })
                            }
                        }
                    }
                }
            }
        }
    }

    if (showExport) {
        AlertDialog(onDismissRequest = { showExport = false }, title = { Text("Request data export") },
            text = { Text("Submit a Data Subject Access Request (export) on behalf of a driver.") },
            confirmButton = { FleetButton(text = "Submit", onClick = { showExport = false; scope.launch { repository.requestDataExport().onSuccess { status = "Export requested." }.onFailure { status = errorCopy((it as? com.fleetpulse.app.data.remote.AppException)?.errorCode ?: "UNKNOWN", locale) } } }) },
            dismissButton = { TextButton(onClick = { showExport = false }) { Text("Cancel") } })
    }
    if (showDelete) {
        AlertDialog(onDismissRequest = { showDelete = false }, title = { Text("Request account deletion") },
            text = { Text("Submit a data deletion request. This is irreversible once processed.") },
            confirmButton = { FleetButton(text = "Submit", onClick = { showDelete = false; scope.launch { repository.requestDataDeletion().onSuccess { status = "Deletion requested." }.onFailure { status = errorCopy((it as? com.fleetpulse.app.data.remote.AppException)?.errorCode ?: "UNKNOWN", locale) } } }) },
            dismissButton = { TextButton(onClick = { showDelete = false }) { Text("Cancel") } })
    }
}
