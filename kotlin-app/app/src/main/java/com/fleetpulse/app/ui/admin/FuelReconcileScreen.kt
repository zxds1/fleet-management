package com.fleetpulse.app.ui.admin

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.BorderStroke
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
import com.fleetpulse.app.ui.components.StatusChip
import com.fleetpulse.app.ui.theme.*

@Composable
fun FuelReconcileScreen(repository: FleetRepository, locale: String, nav: NavController) {
    val purchases by repository.refuelPurchases.collectAsState()
    LaunchedEffect(Unit) { repository.refreshFuelReconciliationInbox() }
    if (purchases.isEmpty()) {
        EmptyState(icon = Icons.Filled.LocalGasStation, title = "No pending fuel", message = "Reconciliation inbox is empty. Import a statement to populate it.")
        return
    }
    AdminListScaffold(locale, Icons.Filled.LocalGasStation, "No pending fuel", "", isEmpty = false) {
        items(purchases, key = { it.id }) { p ->
            val color = when (p.badge) {
                com.fleetpulse.app.data.FuelPendingBadge.FLAGGED -> StatusDanger
                com.fleetpulse.app.data.FuelPendingBadge.REVIEW -> StatusWarning
                else -> StatusInfo
            }
            Surface(color = BentoCardBg, shape = RoundedCornerShape(16.dp), border = BorderStroke(1.dp, BentoBorder),
                modifier = Modifier.fillMaxWidth().clickable { nav.navigate("fuel_purchase_detail/${p.id}") }.testTag("fuel_row_${p.id}")) {
                Column(Modifier.padding(16.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(p.vehiclePlate ?: p.vehicleId ?: "vehicle", style = MaterialTheme.typography.bodyLarge, color = BentoTextPrimary, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
                        StatusChip(text = p.badge.name, color = color)
                    }
                    Text("${p.driverName ?: "—"} · ${p.stationName ?: "—"} · ${p.amountSpent?.let { "$it" } ?: "—"}", style = MaterialTheme.typography.bodySmall, color = BentoTextSecondary)
                }
            }
        }
    }
}
