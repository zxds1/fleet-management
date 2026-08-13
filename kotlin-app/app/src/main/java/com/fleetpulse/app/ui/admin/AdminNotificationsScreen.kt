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
fun AdminNotificationsScreen(repository: FleetRepository, locale: String, nav: NavController) {
    val notifications by repository.notifications.collectAsState()
    if (notifications.isEmpty()) {
        EmptyState(icon = Icons.Filled.Notifications, title = "No notifications", message = "Your personal alerts arrive here in real time.")
        return
    }
    AdminListScaffold(locale, Icons.Filled.Notifications, "No notifications", "", isEmpty = false) {
        items(notifications, key = { it.id }) { n ->
            Surface(color = BentoCardBg, shape = RoundedCornerShape(16.dp), border = BorderStroke(1.dp, BentoBorder), modifier = Modifier.fillMaxWidth()) {
                Column(Modifier.padding(16.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(n.title, style = MaterialTheme.typography.bodyLarge, color = BentoTextPrimary, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
                        if (!n.isRead) StatusChip(text = "NEW", color = StatusInfo)
                    }
                    Text(n.message, style = MaterialTheme.typography.bodySmall, color = BentoTextSecondary)
                }
            }
        }
    }
}
