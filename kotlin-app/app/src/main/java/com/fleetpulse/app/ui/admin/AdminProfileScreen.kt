package com.fleetpulse.app.ui.admin

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController
import com.fleetpulse.app.data.ActiveShell
import com.fleetpulse.app.data.AppConstants
import com.fleetpulse.app.data.repo.FleetRepository
import com.fleetpulse.app.ui.theme.*
import kotlinx.coroutines.launch

@Composable
fun AdminProfileScreen(
    repository: FleetRepository,
    locale: String,
    nav: NavController,
    onLogout: () -> Unit,
) {
    val principal by repository.principal.collectAsState()
    var lang by remember { mutableStateOf(locale) }
    val scope = rememberCoroutineScope()
    var status by remember { mutableStateOf<String?>(null) }

    var curPw by remember { mutableStateOf("") }
    var newPw by remember { mutableStateOf("") }
    var phone by remember { mutableStateOf(principal?.phone ?: "") }

    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text("Profile", style = MaterialTheme.typography.titleLarge, color = BentoTextPrimary)
        AdminRowCard(title = "Email", subtitle = principal?.email ?: "—")
        AdminRowCard(title = "Roles", subtitle = principal?.roles?.joinToString(", ") ?: "—")
        AdminRowCard(title = "Permissions", subtitle = principal?.permissions?.size?.let { "$it granted" } ?: "—")
        status?.let { Text(it, color = StatusSafe, style = MaterialTheme.typography.bodySmall) }

        Text("Locale", style = MaterialTheme.typography.titleMedium, color = BentoTextPrimary)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            AppConstants.APP_LOCALES.forEach { (code, label) ->
                val selected = lang == code
                Button(onClick = { lang = code; repository.setLanguage(code); scope.launch { repository.updateOwnProfile(locale = code) }.invokeOnCompletion { status = "Locale updated." } },
                    colors = ButtonDefaults.buttonColors(containerColor = if (selected) BentoBluePrimary else BentoCardBg),
                    modifier = Modifier.weight(1f).testTag("locale_$code")) { Text(label, color = if (selected) BentoTextPrimary else BentoTextSecondary) }
            }
        }

        OutlinedTextField(value = phone, onValueChange = { phone = it }, label = { Text("Phone") }, singleLine = true, modifier = Modifier.fillMaxWidth().testTag("profile_phone"))
        FleetButton(text = "Save profile", onClick = { scope.launch { repository.updateOwnProfile(phone = phone.ifBlank { null }).onSuccess { status = "Profile saved." }.onFailure { status = errorCopy((it as? com.fleetpulse.app.data.remote.AppException)?.errorCode ?: "UNKNOWN", locale) } } }, modifier = Modifier.testTag("profile_save"))

        Text("Change password", style = MaterialTheme.typography.titleMedium, color = BentoTextPrimary)
        OutlinedTextField(value = curPw, onValueChange = { curPw = it }, label = { Text("Current password") }, singleLine = true, visualTransformation = PasswordVisualTransformation(), modifier = Modifier.fillMaxWidth().testTag("profile_cur_pw"))
        OutlinedTextField(value = newPw, onValueChange = { newPw = it }, label = { Text("New password (min 8)") }, singleLine = true, visualTransformation = PasswordVisualTransformation(), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password), modifier = Modifier.fillMaxWidth().testTag("profile_new_pw"))
        FleetButton(
            text = "Update password",
            onClick = {
                if (curPw.isBlank() || newPw.length < 8) return@FleetButton
                scope.launch {
                    repository.changePassword(curPw, newPw).onSuccess { status = "Password updated — all sessions signed out." }.onFailure { status = errorCopy((it as? com.fleetpulse.app.data.remote.AppException)?.errorCode ?: "UNKNOWN", locale) }
                }
            },
            enabled = curPw.isNotBlank() && newPw.length >= 8,
            modifier = Modifier.testTag("profile_pw_save"),
        )

        AdminRowCard(title = "Switch to Driver shell", subtitle = "Open the driver app", onClick = { repository.setActiveShell(ActiveShell.DRIVER) }, testTag = "switch_driver")
        Spacer(Modifier.height(8.dp))
        Button(onClick = onLogout, colors = ButtonDefaults.buttonColors(containerColor = StatusDanger), modifier = Modifier.fillMaxWidth().testTag("logout")) { Text("Log out") }
    }
}
