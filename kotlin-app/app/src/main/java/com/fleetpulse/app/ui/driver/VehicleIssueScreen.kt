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
import com.fleetpulse.app.data.AnomalySeverity
import com.fleetpulse.app.data.AppConstants
import com.fleetpulse.app.data.repo.FleetRepository
import com.fleetpulse.app.ui.components.SectionCard
import com.fleetpulse.app.ui.theme.*
import kotlinx.coroutines.launch

@Composable
fun VehicleIssueScreen(repository: FleetRepository, nav: NavController, locale: String) {
    val vehicles by repository.vehicles.collectAsState()
    val shift by repository.activeShift.collectAsState()
    val scope = rememberCoroutineScope()
    val categories = AppConstants.VEHICLE_ISSUE_CATEGORIES
    val severities = AppConstants.VEHICLE_ISSUE_SEVERITIES

    var category by remember { mutableStateOf(categories[0]) }
    var severity by remember { mutableStateOf("WARNING") }
    var description by remember { mutableStateOf("") }
    var localError by remember { mutableStateOf<String?>(null) }
    var submitting by remember { mutableStateOf(false) }
    var done by remember { mutableStateOf(false) }

    val vehicleId = shift?.vehicleId ?: vehicles.firstOrNull()?.id

    if (done) {
        Column(modifier = Modifier.fillMaxSize().padding(32.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
            Icon(Icons.Filled.CheckCircle, contentDescription = null, tint = StatusSafe, modifier = Modifier.size(64.dp))
            Spacer(Modifier.height(16.dp))
            Text("Issue reported", style = MaterialTheme.typography.titleLarge, color = BentoTextPrimary)
            Spacer(Modifier.height(16.dp))
            Button(onClick = { nav.popBackStack() }, colors = ButtonDefaults.buttonColors(containerColor = BentoBluePrimary)) { Text(t(locale, "common.back")) }
        }
        return
    }

    Column(modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp)) {
        BackButton({ nav.popBackStack() }, locale)
        Spacer(Modifier.height(8.dp))
        ScreenTitle("Report Vehicle Issue")
        Spacer(Modifier.height(16.dp))

        if (vehicleId == null) {
            Text("No vehicle assigned — cannot report an issue.", color = StatusWarning)
            return
        }

        SectionCard {
            Text("Category", style = MaterialTheme.typography.bodyMedium, color = BentoTextSecondary)
            Spacer(Modifier.height(6.dp))
            Row(Modifier.fillMaxWidth().wrapContentHeight(), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                categories.forEach { c ->
                    Button(
                        onClick = { category = c },
                        modifier = Modifier.weight(1f),
                        colors = ButtonDefaults.buttonColors(containerColor = if (category == c) BentoBluePrimary else BentoCardBg, contentColor = if (category == c) BentoTextPrimary else BentoTextPrimary),
                        contentPadding = PaddingValues(4.dp, 8.dp),
                    ) { Text(c, style = MaterialTheme.typography.bodySmall) }
                }
            }
            Spacer(Modifier.height(12.dp))
            Text("Severity", style = MaterialTheme.typography.bodyMedium, color = BentoTextSecondary)
            Spacer(Modifier.height(6.dp))
            Row(Modifier.fillMaxWidth().wrapContentHeight(), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                severities.forEach { s ->
                    Button(
                        onClick = { severity = s },
                        modifier = Modifier.weight(1f),
                        colors = ButtonDefaults.buttonColors(containerColor = if (severity == s) BentoBluePrimary else BentoCardBg, contentColor = if (severity == s) BentoTextPrimary else BentoTextPrimary),
                        contentPadding = PaddingValues(4.dp, 8.dp),
                    ) { Text(s, style = MaterialTheme.typography.bodySmall) }
                }
            }
            Spacer(Modifier.height(12.dp))
            OutlinedTextField(description, { description = it }, label = { Text("Description") }, modifier = Modifier.fillMaxWidth().testTag("issue_description"), minLines = 3, colors = driverFieldColors())
        }

        if (localError != null) { Spacer(Modifier.height(8.dp)); Text(localError!!, color = StatusDanger) }

        Spacer(Modifier.height(20.dp))
        Button(
            onClick = {
                if (description.isBlank()) { localError = "Description is required"; return@Button }
                submitting = true
                scope.launch {
                    repository.reportVehicleIssue(vehicleId, category, description.trim(), severity)
                    done = true
                }
            },
            enabled = !submitting,
            modifier = Modifier.fillMaxWidth().height(52.dp).testTag("issue_submit"),
            colors = ButtonDefaults.buttonColors(containerColor = BentoBluePrimary),
        ) { Text("Submit report") }
    }
}
