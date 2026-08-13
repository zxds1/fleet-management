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
fun DvirReviewScreen(repository: FleetRepository, locale: String, nav: NavController) {
    val reports by repository.dvirReports.collectAsState()
    LaunchedEffect(Unit) { repository.refreshDvirInbox() }
    if (reports.isEmpty()) {
        EmptyState(icon = Icons.Filled.Checklist, title = "No inspections", message = "Completed DVIR inspections awaiting review will appear here.")
        return
    }
    AdminListScaffold(locale, Icons.Filled.Checklist, "No inspections", "", isEmpty = false) {
        items(reports, key = { it.id }) { r ->
            val flagged = r.overallStatus.contains("FLAG", ignoreCase = true) || r.defectCount > 0
            Surface(color = BentoCardBg, shape = RoundedCornerShape(16.dp), border = BorderStroke(1.dp, BentoBorder),
                modifier = Modifier.fillMaxWidth().clickable { nav.navigate("dvir_review_detail/${r.id}") }.testTag("dvir_row_${r.id}")) {
                Column(Modifier.padding(16.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(r.id.take(8), style = MaterialTheme.typography.bodyLarge, color = BentoTextPrimary, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
                        StatusChip(text = r.overallStatus, color = if (flagged) StatusWarning else StatusSafe)
                    }
                    Text("${r.vehicleId ?: "vehicle"} · ${r.defectCount} defect(s)", style = MaterialTheme.typography.bodySmall, color = BentoTextSecondary)
                }
            }
        }
    }
}
