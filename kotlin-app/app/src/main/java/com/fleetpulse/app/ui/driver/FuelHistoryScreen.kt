package com.fleetpulse.app.ui.driver

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ReceiptLong
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController
import com.fleetpulse.app.data.repo.FleetRepository
import com.fleetpulse.app.ui.components.EmptyState
import com.fleetpulse.app.ui.components.SectionCard
import com.fleetpulse.app.ui.components.StatusChip
import com.fleetpulse.app.ui.theme.*

@Composable
fun FuelHistoryScreen(repository: FleetRepository, nav: NavController, locale: String) {
    val purchases by repository.refuelPurchases.collectAsState()

    Column(modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp)) {
        BackButton({ nav.popBackStack() }, locale)
        Spacer(Modifier.height(8.dp))
        ScreenTitle(t(locale, "fuelHistory.title"))
        Spacer(Modifier.height(16.dp))

        if (purchases.isEmpty()) {
            EmptyState(Icons.Filled.ReceiptLong, t(locale, "fuelHistory.title"), "No fuel purchases to reconcile yet.")
            return
        }

        purchases.forEach { p ->
            SectionCard(modifier = Modifier.fillMaxWidth().padding(bottom = 12.dp)) {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    Text(p.vehiclePlate ?: p.vehicleId ?: "Vehicle", style = MaterialTheme.typography.titleMedium, color = BentoTextPrimary)
                    val tone = when (p.badge) {
                        com.fleetpulse.app.data.FuelPendingBadge.FLAGGED -> StatusDanger
                        com.fleetpulse.app.data.FuelPendingBadge.REVIEW -> StatusWarning
                        else -> StatusSafe
                    }
                    StatusChip(p.badge.name, tone)
                }
                Spacer(Modifier.height(6.dp))
                Text("Driver: ${p.driverName ?: "—"}", style = MaterialTheme.typography.bodyMedium, color = BentoTextSecondary)
                Text("Odometer: ${p.odometerKm ?: "—"} km", style = MaterialTheme.typography.bodyMedium, color = BentoTextSecondary)
                Text("Litres: ${p.litersPumped ?: "—"}  •  Amount: ${p.amountSpent ?: "—"}", style = MaterialTheme.typography.bodyMedium, color = BentoTextSecondary)
                if (p.confidenceScore != null) Text("Confidence: ${(p.confidenceScore!! * 100).toInt()}%", style = MaterialTheme.typography.bodySmall, color = BentoTextSecondary)
                if (p.badge == com.fleetpulse.app.data.FuelPendingBadge.REVIEW || p.badge == com.fleetpulse.app.data.FuelPendingBadge.FLAGGED) {
                    Spacer(Modifier.height(8.dp))
                    OutlinedButton(
                        onClick = { nav.navigate("fuel_correction/${p.id}") },
                        modifier = Modifier.testTag("correct_${p.id}"),
                        colors = ButtonDefaults.outlinedButtonColors(contentColor = BentoBluePrimary),
                    ) { Text("Correct", style = MaterialTheme.typography.bodyMedium) }
                }
            }
        }
    }
}
