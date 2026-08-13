package com.fleetpulse.app.ui.driver

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CloudUpload
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController
import com.fleetpulse.app.data.QueueStatus
import com.fleetpulse.app.data.repo.FleetRepository
import com.fleetpulse.app.ui.components.EmptyState
import com.fleetpulse.app.ui.components.SectionCard
import com.fleetpulse.app.ui.components.StatusChip
import com.fleetpulse.app.ui.theme.*

@Composable
fun OutboxScreen(repository: FleetRepository, nav: NavController, locale: String, isConnected: Boolean) {
    val items by repository.queueItems.collectAsState()
    val pending = items.count { it.status == QueueStatus.PENDING || it.status == QueueStatus.INFLIGHT || it.status == QueueStatus.FAILED_REVIEW }

    Column(modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp)) {
        BackButton({ nav.popBackStack() }, locale)
        Spacer(Modifier.height(8.dp))
        ScreenTitle(t(locale, "outbox.title"))
        Spacer(Modifier.height(8.dp))
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            SummaryChip("Total", items.size, BentoTextPrimary)
            SummaryChip("Pending", items.count { it.status == QueueStatus.PENDING }, StatusWarning)
            SummaryChip("Failed", items.count { it.status == QueueStatus.FAILED_REVIEW }, StatusDanger)
            SummaryChip("In-flight", items.count { it.status == QueueStatus.INFLIGHT }, StatusInfo)
        }
        if (!isConnected) {
            Spacer(Modifier.height(8.dp))
            Text("Offline — writes are queued locally and will sync when reconnected.", color = StatusWarning, style = MaterialTheme.typography.bodyMedium)
        }
        Spacer(Modifier.height(16.dp))

        if (items.isEmpty()) {
            EmptyState(Icons.Filled.CloudUpload, t(locale, "outbox.title"), "Outbox is clear. All writes synced.")
            return
        }

        items.forEach { item ->
            val tone = when (item.status) {
                QueueStatus.PENDING -> StatusWarning
                QueueStatus.INFLIGHT -> StatusInfo
                QueueStatus.FAILED_REVIEW -> StatusDanger
                QueueStatus.DISCARDED -> BentoTextSecondary
                QueueStatus.DONE -> StatusSafe
            }
            SectionCard(modifier = Modifier.fillMaxWidth().padding(bottom = 12.dp).testTag("outbox_item_${item.id}")) {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                    Text(item.summary, style = MaterialTheme.typography.titleMedium, color = BentoTextPrimary)
                    StatusChip(item.status.name, tone)
                }
                Spacer(Modifier.height(6.dp))
                Text("${item.method} ${item.path}  •  attempts: ${item.attempts}", style = MaterialTheme.typography.bodySmall, color = BentoTextSecondary)
                if (item.lastErrorCode != null) {
                    Spacer(Modifier.height(4.dp))
                    Text("Error: ${item.lastErrorCode}${item.lastErrorMessage?.let { " — $it" } ?: ""}", style = MaterialTheme.typography.bodySmall, color = StatusDanger)
                }
                if (item.status == QueueStatus.FAILED_REVIEW || item.status == QueueStatus.PENDING) {
                    Spacer(Modifier.height(12.dp))
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Button(
                            onClick = { repository.retryQueueItem(item.id) },
                            modifier = Modifier.weight(1f).height(44.dp).testTag("outbox_retry"),
                            colors = ButtonDefaults.buttonColors(containerColor = BentoPurplePrimary),
                        ) { Text(t(locale, "common.retry")) }
                        Button(
                            onClick = { repository.discardQueueItem(item.id) },
                            modifier = Modifier.weight(1f).height(44.dp).testTag("outbox_discard"),
                            colors = ButtonDefaults.buttonColors(containerColor = BentoCardBg, contentColor = BentoTextPrimary),
                        ) { Text(t(locale, "common.discard")) }
                    }
                }
            }
        }
    }
}

@Composable
private fun SummaryChip(label: String, value: Int, color: androidx.compose.ui.graphics.Color) {
    Surface(color = BentoDarkBadge, shape = MaterialTheme.shapes.small, modifier = Modifier.padding(2.dp)) {
        Column(Modifier.padding(8.dp).width(72.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Text("$value", style = MaterialTheme.typography.titleMedium, color = color)
            Text(label, style = MaterialTheme.typography.bodySmall, color = BentoTextSecondary)
        }
    }
}
