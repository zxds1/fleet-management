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
import com.fleetpulse.app.data.RefuelPurchase
import com.fleetpulse.app.data.repo.FleetRepository
import com.fleetpulse.app.ui.components.StatusChip
import com.fleetpulse.app.ui.theme.*

@Composable
fun AdminFuelPurchaseDetailScreen(repository: FleetRepository, locale: String, id: String, nav: NavController) {
    val purchases by repository.refuelPurchases.collectAsState()
    val principal by repository.principal.collectAsState()
    val scope = rememberCoroutineScope()
    val localPurchase = purchases.firstOrNull { it.id == id }
    var loading by remember { mutableStateOf(false) }
    var rejectionReason by remember { mutableStateOf("") }
    var result by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(id, localPurchase) {
        if (localPurchase == null && !loading) {
            loading = true
            repository.refreshFuelReconciliationInbox()
            loading = false
        }
    }

    val purchase = localPurchase ?: repository.refuelPurchases.value.firstOrNull { it.id == id }

    if (loading) {
        Box(Modifier.fillMaxSize().padding(32.dp), contentAlignment = Alignment.Center) {
            CircularProgressIndicator(color = BentoBluePrimary)
        }
        return
    }
    if (purchase == null) {
        Box(Modifier.fillMaxSize().padding(32.dp), contentAlignment = Alignment.Center) { Text("Purchase not found", color = BentoTextSecondary) }
        return
    }

    val canVerify = principal?.hasPermission(Permission.FUEL_VERIFY) ?: false
    val canClearPayment = principal?.hasPermission(Permission.FUEL_CLEAR_PAYMENT) ?: false

    Column(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text("Purchase ${purchase.id.take(8)}", style = MaterialTheme.typography.titleLarge, color = BentoTextPrimary)
        StatusChip(text = purchase.badge.name, color = StatusWarning)
        AdminRowCard(title = "Vehicle", subtitle = purchase.vehiclePlate ?: purchase.vehicleId ?: "—")
        AdminRowCard(title = "Driver", subtitle = purchase.driverName ?: "—")
        AdminRowCard(title = "Station", subtitle = purchase.stationName ?: "—")
        AdminRowCard(title = "Amount", subtitle = purchase.amountSpent?.toString() ?: "—")
        AdminRowCard(title = "Litres", subtitle = purchase.litersPumped?.toString() ?: "—")
        AdminRowCard(title = "Odometer", subtitle = purchase.odometerKm?.toString() ?: "—")
        purchase.confidenceScore?.let { AdminRowCard(title = "Confidence", subtitle = "%.0f%%".format(it * 100)) }

        result?.let { Text(it, color = StatusSafe, style = MaterialTheme.typography.bodySmall) }

        if (purchase.approvalStatus.name != "APPROVED") {
            OutlinedTextField(value = rejectionReason, onValueChange = { rejectionReason = it }, label = { Text("Rejection reason") },
                modifier = Modifier.fillMaxWidth(),
                colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = BentoBluePrimary, unfocusedBorderColor = BentoBorder))

            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                if (canVerify) {
                    Button(onClick = { scope.launch { repository.verifyPurchase(purchase.id, "VERIFY").onSuccess { result = "Verified" }.onFailure { result = errorCopy((it as? com.fleetpulse.app.data.remote.AppException)?.errorCode ?: "UNKNOWN", locale) } } },
                        colors = ButtonDefaults.buttonColors(containerColor = StatusSafe), modifier = Modifier.weight(1f).testTag("fuel_verify")) { Text("Verify") }
                    Button(onClick = { scope.launch { repository.verifyPurchase(purchase.id, "REJECT", rejectionReason = rejectionReason.ifEmpty { null }).onSuccess { result = "Rejected" }.onFailure { result = errorCopy((it as? com.fleetpulse.app.data.remote.AppException)?.errorCode ?: "UNKNOWN", locale) } } },
                        colors = ButtonDefaults.buttonColors(containerColor = StatusDanger), modifier = Modifier.weight(1f).testTag("fuel_reject")) { Text("Reject") }
                }
                if (canClearPayment) {
                    Button(onClick = { scope.launch { repository.verifyPurchase(purchase.id, "CLEAR_PAYMENT").onSuccess { result = "Payment cleared" }.onFailure { result = errorCopy((it as? com.fleetpulse.app.data.remote.AppException)?.errorCode ?: "UNKNOWN", locale) } } },
                        colors = ButtonDefaults.buttonColors(containerColor = BentoBluePrimary), modifier = Modifier.weight(1f).testTag("fuel_clear_payment")) { Text("Clear Payment") }
                }
            }
            if (!canVerify && !canClearPayment) {
                Text("You don't have permission to act on this purchase.", color = BentoTextSecondary, style = MaterialTheme.typography.bodySmall)
            }
        }
    }
}
