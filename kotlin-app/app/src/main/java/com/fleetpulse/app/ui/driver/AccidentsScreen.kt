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

@Composable
fun AccidentsScreen(repository: FleetRepository, nav: NavController, locale: String) {
    val shift by repository.activeShift.collectAsState()
    val vehicles by repository.vehicles.collectAsState()
    val scope = rememberCoroutineScope()
    var reason by remember { mutableStateOf("") }
    var statement by remember { mutableStateOf("") }
    var localError by remember { mutableStateOf<String?>(null) }
    var submitting by remember { mutableStateOf(false) }
    var maydayFired by remember { mutableStateOf(false) }

    val vehicleId = shift?.vehicleId ?: vehicles.firstOrNull()?.id

    Column(modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp)) {
        BackButton({ nav.popBackStack() }, locale)
        Spacer(Modifier.height(8.dp))
        ScreenTitle(t(locale, "accidents.title"))
        Spacer(Modifier.height(16.dp))

        SectionCard {
            Text("Report an accident", style = MaterialTheme.typography.titleMedium, color = BentoTextPrimary)
            Spacer(Modifier.height(8.dp))
            OutlinedTextField(
                value = statement, onValueChange = { statement = it },
                label = { Text("Driver statement (optional)") }, modifier = Modifier.fillMaxWidth(),
                minLines = 3, colors = driverFieldColors(),
            )
            Spacer(Modifier.height(12.dp))
            Button(
                onClick = {
                    submitting = true
                    scope.launch {
                        repository.reportAccident(shift?.id, vehicleId, statement.ifBlank { null })
                        nav.navigate("my_accidents")
                    }
                },
                modifier = Modifier.fillMaxWidth().height(48.dp),
                colors = ButtonDefaults.buttonColors(containerColor = BentoCardBg, contentColor = BentoTextPrimary),
            ) { Text("Submit accident report") }
        }

        Spacer(Modifier.height(16.dp))
        SectionCard(modifier = Modifier.fillMaxWidth()) {
            Text("EMERGENCY MAYDAY", style = MaterialTheme.typography.titleMedium, color = StatusDanger)
            Spacer(Modifier.height(8.dp))
            OutlinedTextField(
                value = reason, onValueChange = { reason = it },
                label = { Text("Reason (required)") }, modifier = Modifier.fillMaxWidth().testTag("mayday_reason"),
                singleLine = true, colors = driverFieldColors(),
            )
            Spacer(Modifier.height(12.dp))
            Button(
                onClick = {
                    if (reason.isBlank()) { localError = "A reason is required for MAYDAY"; return@Button }
                    submitting = true
                    scope.launch {
                        repository.triggerMayday(shift?.id, vehicleId, reason.trim())
                        maydayFired = true
                        submitting = false
                    }
                },
                enabled = !submitting,
                modifier = Modifier.fillMaxWidth().height(52.dp).testTag("mayday_btn"),
                colors = ButtonDefaults.buttonColors(containerColor = StatusDanger, contentColor = BentoTextPrimary),
            ) { Text("TRIGGER MAYDAY") }
        }

        if (maydayFired) {
            Spacer(Modifier.height(12.dp))
            Text("Mayday dispatched — help has been alerted.", color = StatusSafe)
        }
        if (localError != null) {
            Spacer(Modifier.height(8.dp))
            Text(localError!!, color = StatusDanger)
        }
        Spacer(Modifier.height(12.dp))
        TextButton(onClick = { nav.navigate("my_accidents") }) { Text("View my accidents", color = BentoPurplePrimary) }
    }
}
