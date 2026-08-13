package com.fleetpulse.app.ui.admin

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.BorderStroke
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController
import com.fleetpulse.app.data.Permission
import com.fleetpulse.app.data.repo.FleetRepository
import com.fleetpulse.app.ui.components.StatusChip
import com.fleetpulse.app.ui.theme.*

@Composable
fun AdminDriverDetailScreen(repository: FleetRepository, locale: String, id: String, nav: NavController) {
    val roster by repository.driverRoster.collectAsState()
    val principal by repository.principal.collectAsState()
    val scope = rememberCoroutineScope()
    val driver = roster.firstOrNull { it.id == id }
    var enrollResult by remember { mutableStateOf<repository.MfaEnrollResult?>(null) }
    var status by remember { mutableStateOf<String?>(null) }

    if (driver == null) {
        Box(Modifier.fillMaxSize().padding(32.dp), contentAlignment = Alignment.Center) { Text("Driver not found", color = BentoTextSecondary) }
        return
    }
    val canMfa = principal?.hasPermission(Permission.USER_MANAGE) ?: false
    val canRevoke = principal?.hasPermission(Permission.DEVICE_REVOKED) ?: false

    Column(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(driver.name, style = MaterialTheme.typography.titleLarge, color = BentoTextPrimary)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            StatusChip(text = driver.status, color = StatusSafe)
            StatusChip(text = if (driver.mfaEnrolled) "MFA ON" else "MFA OFF", color = if (driver.mfaEnrolled) StatusSafe else StatusWarning)
        }
        AdminRowCard(title = "Phone", subtitle = driver.phone ?: "—")
        AdminRowCard(title = "Email", subtitle = driver.email ?: "—")
        AdminRowCard(title = "Assigned vehicle", subtitle = driver.assignedVehicleId ?: "—")
        AdminRowCard(title = "Active sessions", subtitle = driver.activeSessionsCount.toString())

        status?.let { Text(it, color = StatusSafe, style = MaterialTheme.typography.bodySmall) }

        var adminPassword by remember { mutableStateOf("") }
        OutlinedTextField(
            value = adminPassword, onValueChange = { adminPassword = it },
            label = { Text("Your password (required to enroll MFA)") }, modifier = Modifier.fillMaxWidth(),
            visualTransformation = PasswordVisualTransformation(),
            colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = BentoPurplePrimary, unfocusedBorderColor = BentoBorder),
        )

        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            if (canMfa) Button(onClick = { scope.launch { repository.enrollDriverMfa(adminPassword, driver.id).onSuccess { enrollResult = it; status = "Enrollment ready — show QR to driver" }.onFailure { status = errorCopy((it as? com.fleetpulse.app.data.remote.AppException)?.errorCode ?: "UNKNOWN", locale) } } },
                colors = ButtonDefaults.buttonColors(containerColor = BentoPurplePrimary), modifier = Modifier.weight(1f).testTag("enroll_mfa")) { Text("Enroll MFA") }
            if (canRevoke) Button(onClick = { scope.launch { repository.revokeDriverSessions(driver.id).onSuccess { status = "Sessions revoked" }.onFailure { status = errorCopy((it as? com.fleetpulse.app.data.remote.AppException)?.errorCode ?: "UNKNOWN", locale) } } },
                colors = ButtonDefaults.buttonColors(containerColor = StatusDanger), modifier = Modifier.weight(1f).testTag("revoke_sessions")) { Text("Revoke Sessions") }
        }

        val canManage = principal?.hasPermission(Permission.USER_MANAGE) ?: false
        if (canManage) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                if (driver.status == "PENDING") OutlinedButton(onClick = { scope.launch { repository.approveDriver(driver.id).onSuccess { status = "Driver approved" }.onFailure { status = errorCopy((it as? com.fleetpulse.app.data.remote.AppException)?.errorCode ?: "UNKNOWN", locale) } } },
                    modifier = Modifier.weight(1f).testTag("approve_driver")) { Text("Approve") }
                if (driver.status != "SUSPENDED") OutlinedButton(onClick = { scope.launch { repository.suspendUser(driver.id).onSuccess { status = "User suspended" }.onFailure { status = errorCopy((it as? com.fleetpulse.app.data.remote.AppException)?.errorCode ?: "UNKNOWN", locale) } } },
                    colors = ButtonDefaults.outlinedButtonColors(contentColor = StatusDanger), modifier = Modifier.weight(1f).testTag("suspend_driver")) { Text("Suspend") }
                else OutlinedButton(onClick = { scope.launch { repository.reinstateUser(driver.id).onSuccess { status = "User reinstated" }.onFailure { status = errorCopy((it as? com.fleetpulse.app.data.remote.AppException)?.errorCode ?: "UNKNOWN", locale) } } },
                    modifier = Modifier.weight(1f).testTag("reinstate_driver")) { Text("Reinstate") }
            }
        }

        enrollResult?.let { res ->
            Text("TOTP setup URI (show to driver out-of-band):", style = MaterialTheme.typography.bodySmall, color = BentoTextSecondary)
            Surface(color = BentoBackground, shape = RoundedCornerShape(12.dp), border = BorderStroke(1.dp, BentoBorder), modifier = Modifier.fillMaxWidth()) {
                Text(res.otpauthUri.ifEmpty { "(server did not return a uri)" }, style = MaterialTheme.typography.bodySmall, color = BentoTextPrimary, modifier = Modifier.padding(12.dp))
            }
            Text("Recovery codes (once only):", style = MaterialTheme.typography.bodySmall, color = BentoTextSecondary)
            res.recoveryCodes.forEach { Text("• $it", style = MaterialTheme.typography.bodySmall, color = BentoTextPrimary) }
        }
    }
}
