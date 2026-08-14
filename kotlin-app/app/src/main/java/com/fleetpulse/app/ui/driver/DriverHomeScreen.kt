package com.fleetpulse.app.ui.driver

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController
import com.fleetpulse.app.data.VehicleDisplayState
import com.fleetpulse.app.data.repo.FleetRepository
import com.fleetpulse.app.ui.components.SectionCard
import com.fleetpulse.app.ui.components.StatusChip
import com.fleetpulse.app.ui.theme.*

@Composable
fun DriverHomeScreen(repository: FleetRepository, nav: NavController, locale: String) {
    val shift by repository.activeShift.collectAsState()
    val vehicles by repository.vehicles.collectAsState()
    val anomalies by repository.anomalies.collectAsState()
    val hos by repository.hosState.collectAsState()
    val principal by repository.principal.collectAsState()

    val vehicle = shift?.vehicleId?.let { vid -> vehicles.firstOrNull { it.id == vid } }
        ?: vehicles.firstOrNull { it.currentDriverName == principal?.email || it.currentDriverName == principal?.phone }

    Column(modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp)) {
        SectionCard {
            Text(t(locale, "home.greeting"), style = MaterialTheme.typography.titleLarge, color = BentoTextPrimary)
            Spacer(Modifier.height(4.dp))
            Text(principal?.email ?: "", style = MaterialTheme.typography.bodyMedium, color = BentoTextSecondary)
            Spacer(Modifier.height(16.dp))
            Button(
                onClick = { if (shift == null) nav.navigate("clock_in") else nav.navigate("clock_out") },
                modifier = Modifier.fillMaxWidth().height(52.dp).testTag("nav_driver_home"),
                colors = ButtonDefaults.buttonColors(containerColor = BentoBluePrimary),
            ) {
                Icon(if (shift == null) Icons.Filled.Login else Icons.Filled.Logout, contentDescription = null)
                Spacer(Modifier.width(8.dp))
                Text(if (shift == null) t(locale, "home.clockIn") else t(locale, "home.clockOut"))
            }
        }

        Spacer(Modifier.height(16.dp))

        SectionCard {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.Top) {
                Column {
                    Text("Current Assignment", style = MaterialTheme.typography.bodySmall, color = BentoTextSecondary)
                    Spacer(Modifier.height(4.dp))
                    Text(
                        vehicle?.plateNumber ?: t(locale, "home.noActiveShift"),
                        style = MaterialTheme.typography.titleMedium,
                        color = BentoTextPrimary,
                    )
                }
                val state = vehicle?.displayState ?: VehicleDisplayState.PARKED
                StatusChip(state.name, displayStateColor(state))
            }
            Spacer(Modifier.height(12.dp))
            Row(Modifier.fillMaxWidth()) {
                HomeStat("Fuel", "${vehicle?.fuelLevelPct ?: "—"}%")
                HomeStat("Odometer", "${vehicle?.odometerKm ?: "—"} km")
                HomeStat("HOS", "${hos.drivingMinutesToday / 60}h ${hos.drivingMinutesToday % 60}m")
            }
        }

        Spacer(Modifier.height(16.dp))
        Text(t(locale, "home.quickActions"), style = MaterialTheme.typography.titleMedium, color = BentoTextPrimary)
        Spacer(Modifier.height(8.dp))

        val quick = listOf(
            QuickAction("refuel", Icons.Filled.LocalGasStation, t(locale, "tabs.refuel")) { nav.navigate("refuel") },
            QuickAction("inspection", Icons.Filled.FactCheck, t(locale, "tabs.inspect")) { nav.navigate("inspection") },
            QuickAction("accidents", Icons.Filled.Warning, t(locale, "tabs.accidents"), true) { nav.navigate("accidents") },
            QuickAction("vehicle", Icons.Filled.LocalShipping, t(locale, "vehicle.title")) { nav.navigate("vehicle_state") },
            QuickAction("training", Icons.Filled.School, t(locale, "tabs.training")) { nav.navigate("training_hub") },
            QuickAction("resources", Icons.Filled.MenuBook, t(locale, "tabs.resources")) { nav.navigate("resource_library") },
            QuickAction("anomalies", Icons.Filled.ReportProblem, t(locale, "tabs.anomalies")) { nav.navigate("anomalies") },
            QuickAction("notifications", Icons.Filled.Notifications, t(locale, "notifications.title")) { nav.navigate("notifications") },
        )
        quick.chunked(2).forEach { row ->
            Row(Modifier.fillMaxWidth()) {
                row.forEach { qa ->
                    Box(Modifier.weight(1f).padding(4.dp)) {
                        QuickActionTile(qa)
                    }
                }
                if (row.size == 1) Spacer(Modifier.weight(1f).padding(4.dp))
            }
        }

        val todaysAnomalies = anomalies.size
        if (todaysAnomalies > 0) {
            Spacer(Modifier.height(12.dp))
            StatusChip("$todaysAnomalies anomaly(ies) today", StatusWarning)
        }
    }
}

@Composable
private fun HomeStat(label: String, value: String) {
    Column(Modifier.padding(end = 16.dp)) {
        Text(label, style = MaterialTheme.typography.bodySmall, color = BentoTextSecondary)
        Spacer(Modifier.height(2.dp))
        Text(value, style = MaterialTheme.typography.bodyLarge, color = BentoTextPrimary)
    }
}

private data class QuickAction(val key: String, val icon: ImageVector, val label: String, val danger: Boolean = false, val onClick: () -> Unit)

@Composable
private fun QuickActionTile(qa: QuickAction) {
    Surface(
        onClick = qa.onClick,
        color = if (qa.danger) BentoBluePrimaryContainer else BentoCardBg,
        shape = MaterialTheme.shapes.medium,
        border = if (qa.danger) null else androidx.compose.foundation.BorderStroke(1.dp, BentoBorder),
        modifier = Modifier.fillMaxWidth().testTag("qa_${qa.key}").height(96.dp),
    ) {
        Column(Modifier.fillMaxSize(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
            Icon(qa.icon, contentDescription = null, tint = if (qa.danger) StatusDanger else BentoBluePrimary)
            Spacer(Modifier.height(6.dp))
            Text(qa.label, style = MaterialTheme.typography.bodyMedium, color = BentoTextPrimary)
        }
    }
}

fun displayStateColor(state: VehicleDisplayState) = when (state) {
    VehicleDisplayState.QUARANTINED -> StateQuarantined
    VehicleDisplayState.OFFLINE -> StateOffline
    VehicleDisplayState.HOS_ALERT -> StateHosAlert
    VehicleDisplayState.SPEEDING -> StateSpeeding
    VehicleDisplayState.MOVING -> StateMoving
    VehicleDisplayState.IDLING -> StateIdling
    VehicleDisplayState.PARKED -> StateParked
}
