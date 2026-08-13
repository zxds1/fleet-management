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
fun ExpiringDocsScreen(repository: FleetRepository, locale: String, nav: NavController) {
    val docs by repository.documents.collectAsState()
    if (docs.isEmpty()) {
        EmptyState(icon = Icons.Filled.Description, title = "No expiring documents", message = "Asset/licence documents nearing expiry will be listed here.")
        return
    }
    AdminListScaffold(locale, Icons.Filled.Description, "No documents", "", isEmpty = false) {
        items(docs, key = { it.id }) { d ->
            val soon = (d.daysUntilExpiry ?: 999) <= 30
            Surface(color = BentoCardBg, shape = RoundedCornerShape(16.dp), border = BorderStroke(1.dp, BentoBorder),
                modifier = Modifier.fillMaxWidth().clickable { nav.navigate("document_detail/${d.id}") }.testTag("doc_row_${d.id}")) {
                Column(Modifier.padding(16.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(d.title, style = MaterialTheme.typography.bodyLarge, color = BentoTextPrimary, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
                        StatusChip(text = d.docType, color = BentoPurplePrimary)
                    }
                    Text("${d.ownerName} · ${d.daysUntilExpiry?.let { "$it days left" } ?: d.expiresOn ?: "—"}", style = MaterialTheme.typography.bodySmall, color = if (soon) StatusWarning else BentoTextSecondary)
                }
            }
        }
    }
}
