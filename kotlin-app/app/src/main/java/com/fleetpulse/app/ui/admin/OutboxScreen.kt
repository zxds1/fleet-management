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
import com.fleetpulse.app.data.QueueStatus
import com.fleetpulse.app.data.repo.FleetRepository
import com.fleetpulse.app.ui.components.EmptyState
import com.fleetpulse.app.ui.components.StatusChip
import com.fleetpulse.app.ui.theme.*

@Composable
fun OutboxScreen(repository: FleetRepository, locale: String, nav: NavController) {
    val items by repository.queueItems.collectAsState()
    if (items.isEmpty()) {
        EmptyState(icon = Icons.Filled.CloudQueue, title = "Outbox empty", message = "Queued offline writes will appear here and drain automatically when online.")
        return
    }
    AdminListScaffold(locale, Icons.Filled.CloudQueue, "Outbox empty", "", isEmpty = false) {
        items(items, key = { it.id }) { item ->
            val color = when (item.status) {
                QueueStatus.DONE -> StatusSafe
                QueueStatus.FAILED_REVIEW -> StatusDanger
                QueueStatus.INFLIGHT -> StatusInfo
                else -> StatusWarning
            }
            Surface(color = BentoCardBg, shape = RoundedCornerShape(16.dp), border = BorderStroke(1.dp, BentoBorder), modifier = Modifier.fillMaxWidth()) {
                Column(Modifier.padding(16.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(item.summary, style = MaterialTheme.typography.bodyLarge, color = BentoTextPrimary, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
                        StatusChip(text = item.status.name, color = color)
                    }
                    Text("Attempts: ${item.attempts}${item.lastErrorMessage?.let { " · $it" } ?: ""}", style = MaterialTheme.typography.bodySmall, color = BentoTextSecondary)
                    if (item.status == QueueStatus.FAILED_REVIEW || item.status == QueueStatus.PENDING) {
                        Spacer(Modifier.height(8.dp))
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Button(onClick = { repository.retryQueueItem(item.id) }, colors = ButtonDefaults.buttonColors(containerColor = BentoBluePrimary), modifier = Modifier.weight(1f)) { Text("Retry") }
                            Button(onClick = { repository.discardQueueItem(item.id) }, colors = ButtonDefaults.buttonColors(containerColor = StatusDanger), modifier = Modifier.weight(1f)) { Text("Discard") }
                        }
                    }
                }
            }
        }
    }
}
