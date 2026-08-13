package com.fleetpulse.app.ui.driver

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Notifications
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
fun NotificationsScreen(repository: FleetRepository, nav: NavController, locale: String) {
    val notifications by repository.notifications.collectAsState()
    Column(modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp)) {
        BackButton({ nav.popBackStack() }, locale)
        Spacer(Modifier.height(8.dp))
        ScreenTitle(t(locale, "notifications.title"))
        Spacer(Modifier.height(16.dp))
        if (notifications.isEmpty()) {
            EmptyState(Icons.Filled.Notifications, t(locale, "notifications.title"), "No notifications.")
            return
        }
        notifications.forEach { n ->
            SectionCard(modifier = Modifier.fillMaxWidth().padding(bottom = 12.dp)) {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                    Text(n.title, style = MaterialTheme.typography.titleMedium, color = BentoTextPrimary)
                    if (!n.isRead) StatusChip("NEW", StatusInfo)
                }
                Spacer(Modifier.height(6.dp))
                Text(n.message, style = MaterialTheme.typography.bodyMedium, color = BentoTextSecondary)
            }
        }
    }
}
