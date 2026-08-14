package com.fleetpulse.app.ui.admin

import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController
import com.fleetpulse.app.data.Permission
import com.fleetpulse.app.data.repo.FleetRepository
import com.fleetpulse.app.ui.theme.*

@Composable
fun SettingsTriggersScreen(repository: FleetRepository, locale: String, nav: NavController) {
    val principal by repository.principal.collectAsState()
    val scope = rememberCoroutineScope()
    var speed by remember { mutableStateOf("90") }
    var fuel by remember { mutableStateOf("15") }
    var status by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(Unit) {
        repository.listTriggers().onSuccess { body ->
            val triggers = body["data"] as? List<*>
            triggers?.forEach { t ->
                (t as? Map<String, Any?>)?.let {
                    when (it["key"]?.toString()) {
                        "speed.limit_kph" -> speed = it["value"]?.toString() ?: speed
                        "fuel.anomaly_threshold" -> fuel = it["value"]?.toString() ?: fuel
                    }
                }
            }
        }
    }

    if (principal?.hasPermission(Permission.CONFIG_MANAGE) != true) {
        Box(Modifier.fillMaxSize().padding(32.dp), contentAlignment = Alignment.Center) { Text("Permission required to manage alert triggers.", color = BentoTextSecondary) }
        return
    }

    Column(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text("Alert thresholds", style = MaterialTheme.typography.titleLarge, color = BentoTextPrimary)
        OutlinedTextField(value = speed, onValueChange = { speed = it }, label = { Text("Speeding threshold (km/h)") }, modifier = Modifier.fillMaxWidth(),
            colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = BentoBluePrimary, unfocusedBorderColor = BentoBorder))
        OutlinedTextField(value = fuel, onValueChange = { fuel = it }, label = { Text("Fuel anomaly threshold (%)") }, modifier = Modifier.fillMaxWidth(),
            colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = BentoBluePrimary, unfocusedBorderColor = BentoBorder))
        status?.let { Text(it, color = StatusSafe, style = MaterialTheme.typography.bodySmall) }
        Button(onClick = {
            val s = speed.toIntOrNull() ?: 90
            val f = fuel.toIntOrNull() ?: 15
            scope.launch { repository.updateTriggers(s, f).onSuccess { status = "Saved" }.onFailure { status = errorCopy((it as? com.fleetpulse.app.data.remote.AppException)?.errorCode ?: "UNKNOWN", locale) } }
        }, colors = ButtonDefaults.buttonColors(containerColor = BentoBluePrimary), modifier = Modifier.fillMaxWidth().testTag("save_triggers")) { Text("Save") }
    }
}
