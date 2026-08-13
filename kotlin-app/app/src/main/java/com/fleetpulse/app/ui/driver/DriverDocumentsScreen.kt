package com.fleetpulse.app.ui.driver

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Description
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
fun DriverDocumentsScreen(repository: FleetRepository, nav: NavController, locale: String) {
    val documents by repository.documents.collectAsState()
    Column(modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp)) {
        BackButton({ nav.popBackStack() }, locale)
        Spacer(Modifier.height(8.dp))
        ScreenTitle(t(locale, "documents.title"))
        Spacer(Modifier.height(16.dp))
        if (documents.isEmpty()) {
            EmptyState(Icons.Filled.Description, t(locale, "documents.title"), "No documents on file.")
            return
        }
        documents.forEach { d ->
            val expired = (d.daysUntilExpiry ?: 1) <= 0
            val tone = if (expired) StatusDanger else StatusWarning
            SectionCard(modifier = Modifier.fillMaxWidth().padding(bottom = 12.dp)) {
                Text(d.title, style = MaterialTheme.typography.titleMedium, color = BentoTextPrimary)
                Spacer(Modifier.height(6.dp))
                Text("Type: ${d.docType}  •  Owner: ${d.ownerName}", style = MaterialTheme.typography.bodyMedium, color = BentoTextSecondary)
                Spacer(Modifier.height(6.dp))
                StatusChip(d.expiresOn ?: "—", tone)
            }
        }
    }
}
