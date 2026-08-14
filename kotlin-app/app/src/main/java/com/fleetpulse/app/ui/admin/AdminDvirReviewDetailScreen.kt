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
import com.fleetpulse.app.ui.components.StatusChip
import com.fleetpulse.app.ui.theme.*

@Composable
fun AdminDvirReviewDetailScreen(repository: FleetRepository, locale: String, id: String, nav: NavController) {
    val reports by repository.dvirReports.collectAsState()
    val principal by repository.principal.collectAsState()
    val scope = rememberCoroutineScope()
    val report = reports.firstOrNull { it.id == id }
    var detail by remember { mutableStateOf<Map<String, Any?>?>(null) }
    var loading by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var flagReason by remember { mutableStateOf("") }
    var result by remember { mutableStateOf<String?>(null) }
    val canReview = principal?.hasPermission(Permission.INSPECTION_REVIEW) ?: false

    LaunchedEffect(id, report) {
        if (report == null && detail == null && !loading) {
            loading = true
            repository.fetchInspectionDetail(id)
                .onSuccess { detail = it }
                .onFailure { error = it.localizedMessage ?: "Failed to load inspection" }
            loading = false
        }
    }

    val resolvedReport = report ?: (detail?.let { repository.mapInspectionDetail(it) })

    if (resolvedReport == null) {
        if (loading) {
            Box(Modifier.fillMaxSize().padding(32.dp), contentAlignment = Alignment.Center) {
                CircularProgressIndicator(color = BentoBluePrimary)
            }
            return
        }
        error?.let {
            Box(Modifier.fillMaxSize().padding(32.dp), contentAlignment = Alignment.Center) { Text(it, color = StatusDanger) }
            return
        }
        Box(Modifier.fillMaxSize().padding(32.dp), contentAlignment = Alignment.Center) { Text("Inspection not found", color = BentoTextSecondary) }
        return
    }

    val r = resolvedReport

    Column(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text("Inspection ${r.id.take(8)}", style = MaterialTheme.typography.titleLarge, color = BentoTextPrimary)
        StatusChip(text = r.overallStatus, color = if (r.defectCount > 0) StatusWarning else StatusSafe)
        AdminRowCard(title = "Vehicle", subtitle = r.vehicleId ?: "—")
        AdminRowCard(title = "Driver", subtitle = r.driverName ?: "—")
        AdminRowCard(title = "Defects", subtitle = "${r.defectCount}")
        AdminRowCard(title = "Signature", subtitle = r.signatureName.ifEmpty { "—" })

        result?.let { Text(it, color = StatusSafe, style = MaterialTheme.typography.bodySmall) }

        if (canReview) {
            Text(
                "DVIR defect review is enforced server-side; this screen is read-only on mobile.",
                style = MaterialTheme.typography.bodySmall,
                color = BentoTextSecondary,
            )
        }
    }
}
