package com.fleetpulse.app.ui.driver

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.School
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
fun TrainingHubScreen(repository: FleetRepository, nav: NavController, locale: String) {
    val lessons by repository.trainingLessons.collectAsState()
    Column(modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp)) {
        BackButton({ nav.popBackStack() }, locale)
        Spacer(Modifier.height(8.dp))
        ScreenTitle(t(locale, "training.title"))
        Spacer(Modifier.height(16.dp))
        if (lessons.isEmpty()) {
            EmptyState(Icons.Filled.School, t(locale, "training.title"), "No training lessons available.")
            return
        }
        lessons.forEach { l ->
            SectionCard(modifier = Modifier.fillMaxWidth().padding(bottom = 12.dp).clickable { nav.navigate("lesson_detail/${l.id}") }) {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    Text(l.title, style = MaterialTheme.typography.titleMedium, color = BentoTextPrimary)
                    if (l.isCompleted) StatusChip("DONE", StatusSafe) else StatusChip("${l.progressPct}%", StatusInfo)
                }
                Spacer(Modifier.height(6.dp))
                Text("${l.category} • ${l.durationMinutes} min", style = MaterialTheme.typography.bodyMedium, color = BentoTextSecondary)
            }
        }
        Spacer(Modifier.height(8.dp))
        TextButton(onClick = { nav.navigate("resource_library") }) { Text("Resource Library", color = BentoBluePrimary) }
    }
}
