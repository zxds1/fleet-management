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
import com.fleetpulse.app.data.*
import com.fleetpulse.app.data.repo.FleetRepository
import com.fleetpulse.app.ui.components.EmptyState
import com.fleetpulse.app.ui.components.StatusChip
import com.fleetpulse.app.ui.theme.*

@Composable
fun UsersScreen(repository: FleetRepository, locale: String, nav: NavController) {
    val users by repository.tenantUsers.collectAsState()
    LaunchedEffect(Unit) { repository.loadTenantUsers() }
    if (users.isEmpty()) {
        EmptyState(icon = Icons.Filled.People, title = "No users", message = "Tenant users will be listed here.")
        return
    }
    AdminListScaffold(locale, Icons.Filled.People, "No users", "", isEmpty = false) {
        items(users, key = { it.id }) { u ->
            val color = when (u.status) {
                "SUSPENDED" -> StatusDanger
                "PENDING" -> StatusWarning
                else -> StatusSafe
            }
            Surface(color = BentoCardBg, shape = RoundedCornerShape(16.dp), border = BorderStroke(1.dp, BentoBorder),
                modifier = Modifier.fillMaxWidth().clickable { nav.navigate("user_detail/${u.id}") }.testTag("user_row_${u.id}")) {
                Column(Modifier.padding(16.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(u.fullName ?: u.email, style = MaterialTheme.typography.bodyLarge, color = BentoTextPrimary, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
                        StatusChip(text = u.status, color = color)
                    }
                    Text(u.email, style = MaterialTheme.typography.bodySmall, color = BentoTextSecondary)
                    if (u.roles.isNotEmpty()) Text(u.roles.joinToString(", "), style = MaterialTheme.typography.bodySmall, color = BentoPurplePrimary)
                }
            }
        }
    }
}
