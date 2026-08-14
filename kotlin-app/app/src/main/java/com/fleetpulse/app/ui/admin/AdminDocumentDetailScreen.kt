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
import com.fleetpulse.app.data.repo.FleetRepository
import com.fleetpulse.app.ui.components.FleetButton
import com.fleetpulse.app.ui.components.StatusChip
import com.fleetpulse.app.ui.theme.*
import kotlinx.coroutines.launch

@Composable
fun AdminDocumentDetailScreen(repository: FleetRepository, locale: String, id: String, nav: NavController) {
    val docs by repository.documents.collectAsState()
    val scope = rememberCoroutineScope()
    val doc = docs.firstOrNull { it.id == id }
    var note by remember { mutableStateOf("") }
    var status by remember { mutableStateOf<String?>(null) }
    if (doc == null) {
        Box(Modifier.fillMaxSize().padding(32.dp), contentAlignment = Alignment.Center) { Text("Document not found", color = BentoTextSecondary) }
        return
    }
    Column(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(doc.title, style = MaterialTheme.typography.titleLarge, color = BentoTextPrimary)
        StatusChip(text = doc.docType, color = BentoBluePrimary)
        AdminRowCard(title = "Owner", subtitle = doc.ownerName)
        AdminRowCard(title = "Expires", subtitle = doc.expiresOn ?: "—")
        AdminRowCard(title = "Days until expiry", subtitle = doc.daysUntilExpiry?.toString() ?: "—")
        Text("Renewal note", style = MaterialTheme.typography.titleMedium, color = BentoTextPrimary)
        OutlinedTextField(value = note, onValueChange = { note = it }, label = { Text("Note") }, modifier = Modifier.fillMaxWidth().testTag("doc_note"))
        status?.let { Text(it, color = StatusSafe, style = MaterialTheme.typography.bodySmall) }
        FleetButton(
            text = "Save note",
            onClick = {
                if (note.isBlank()) return@FleetButton
                scope.launch {
                    repository.addDocumentRenewalNote(doc.id, note).onSuccess { status = "Note saved." }.onFailure { status = errorCopy((it as? com.fleetpulse.app.data.remote.AppException)?.errorCode ?: "UNKNOWN", locale) }
                }
            },
            enabled = note.isNotBlank(),
            modifier = Modifier.testTag("doc_note_save"),
        )
    }
}
