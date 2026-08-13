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
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController
import com.fleetpulse.app.data.repo.FleetRepository
import com.fleetpulse.app.ui.components.EmptyState
import com.fleetpulse.app.ui.components.FullScreenVehicleMap
import com.fleetpulse.app.ui.components.StatusChip
import com.fleetpulse.app.ui.theme.*

@Composable
fun LiveMapScreen(repository: FleetRepository, locale: String, nav: NavController) {
    val vehicles by repository.vehicles.collectAsState()
    val mapVehicles = vehicles.filter { it.lat != null && it.lng != null }

    if (vehicles.isEmpty()) {
        EmptyState(icon = Icons.Filled.Map, title = "No vehicles", message = "Vehicle positions will appear here from the realtime feed.")
        return
    }

    Box(Modifier.fillMaxSize()) {
        if (mapVehicles.isEmpty()) {
            // Vehicles exist but no coordinates yet — fall back to the list.
            Column(Modifier.fillMaxSize()) {
                Text(
                    "${vehicles.size} vehicles · awaiting positions",
                    style = MaterialTheme.typography.bodySmall, color = BentoTextSecondary,
                    modifier = Modifier.padding(16.dp, 12.dp, 16.dp, 0.dp),
                )
                AdminListScaffold(
                    locale = locale, emptyIcon = Icons.Filled.Map,
                    emptyTitle = "No positions yet", emptyMessage = "Vehicle states stream via the realtime feed.", isEmpty = false,
                ) {
                    items(vehicles, key = { it.id }) { v ->
                        val (label, color) = stateColorChip(v.displayState)
                        Surface(
                            color = BentoCardBg, shape = RoundedCornerShape(16.dp),
                            border = BorderStroke(1.dp, BentoBorder),
                            modifier = Modifier.fillMaxWidth().clickable { nav.navigate("vehicle_detail/${v.id}") }
                                .testTag("vehicle_row_${v.id}"),
                        ) {
                            Column(Modifier.padding(16.dp)) {
                                Text(v.plateNumber, style = MaterialTheme.typography.bodyLarge, color = BentoTextPrimary, fontWeight = FontWeight.SemiBold)
                                Spacer(Modifier.height(8.dp))
                                StatusChip(text = label, color = color)
                            }
                        }
                    }
                }
            }
        } else {
            FullScreenVehicleMap(
                vehicles = mapVehicles,
                onVehicleClick = { nav.navigate("vehicle_detail/${it.id}") },
            )
        }

        Surface(
            color = BentoCardBg.copy(alpha = 0.92f),
            shape = RoundedCornerShape(999.dp),
            border = BorderStroke(1.dp, BentoBorder),
            modifier = Modifier.align(Alignment.TopCenter).padding(top = 12.dp),
        ) {
            Text(
                "${mapVehicles.size} vehicles · live display states",
                style = MaterialTheme.typography.labelMedium, color = BentoTextPrimary,
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
            )
        }
    }
}
