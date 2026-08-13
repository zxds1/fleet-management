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
fun TrainingReviewScreen(repository: FleetRepository, locale: String, nav: NavController) {
    val lessons by repository.trainingLessons.collectAsState()
    val scope = rememberCoroutineScope()
    LaunchedEffect(Unit) { repository.loadTrainingData() }
    if (lessons.isEmpty()) {
        EmptyState(icon = Icons.Filled.School, title = "No training", message = "Training lessons for your fleet appear here.")
        return
    }
    AdminListScaffold(locale, Icons.Filled.School, "No training", "", isEmpty = false) {
        items(lessons, key = { it.id }) { l ->
            Surface(color = BentoCardBg, shape = RoundedCornerShape(16.dp), border = BorderStroke(1.dp, BentoBorder), modifier = Modifier.fillMaxWidth()) {
                Column(Modifier.padding(16.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(l.title, style = MaterialTheme.typography.bodyLarge, color = BentoTextPrimary, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
                        StatusChip(text = if (l.isCompleted) "DONE" else "OPEN", color = if (l.isCompleted) StatusSafe else StatusWarning)
                    }
                    Text("${l.category} · ${l.durationMinutes} min · ${l.progressPct}%", style = MaterialTheme.typography.bodySmall, color = BentoTextSecondary)
                    Spacer(Modifier.height(8.dp))
                    LinearProgressIndicator(progress = { l.progressPct / 100f }, color = BentoPurplePrimary, modifier = Modifier.fillMaxWidth())
                    if (!l.isCompleted) {
                        Spacer(Modifier.height(8.dp))
                        OutlinedButton(onClick = { scope.launch { repository.completeTrainingLesson(l.id) } }, modifier = Modifier.testTag("training_complete_${l.id}")) {
                            Text("Mark complete")
                        }
                    }
                }
            }
        }
    }
}
