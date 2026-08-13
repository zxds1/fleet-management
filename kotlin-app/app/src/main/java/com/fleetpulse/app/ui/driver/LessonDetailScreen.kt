package com.fleetpulse.app.ui.driver

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController
import com.fleetpulse.app.data.repo.FleetRepository
import com.fleetpulse.app.ui.components.SectionCard
import com.fleetpulse.app.ui.theme.*
import kotlinx.coroutines.launch

@Composable
fun LessonDetailScreen(repository: FleetRepository, nav: NavController, locale: String, id: String) {
    val lessons by repository.trainingLessons.collectAsState()
    val lesson = lessons.firstOrNull { it.id == id }
    val scope = rememberCoroutineScope()
    var completed by remember { mutableStateOf(lesson?.isCompleted ?: false) }

    Column(modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp)) {
        BackButton({ nav.popBackStack() }, locale)
        Spacer(Modifier.height(8.dp))
        ScreenTitle(t(locale, "lesson.title"))
        Spacer(Modifier.height(16.dp))
        if (lesson == null) { Text("Lesson not found.", color = BentoTextSecondary); return }
        SectionCard {
            Text(lesson.title, style = MaterialTheme.typography.titleMedium, color = BentoTextPrimary)
            Spacer(Modifier.height(6.dp))
            Text("${lesson.category} • ${lesson.durationMinutes} min", style = MaterialTheme.typography.bodyMedium, color = BentoTextSecondary)
            Spacer(Modifier.height(8.dp))
            LinearProgressIndicator(progress = (if (completed) 100 else lesson.progressPct) / 100f, modifier = Modifier.fillMaxWidth(), color = BentoPurplePrimary)
        }
        Spacer(Modifier.height(20.dp))
        Button(
            onClick = {
                // Best-effort complete; no endpoint invented — falls back to local state if absent.
                scope.launch { runCatching { repository.completeTrainingLesson(id) } }
                completed = true
            },
            modifier = Modifier.fillMaxWidth().height(52.dp).testTag("lesson_complete"),
            colors = ButtonDefaults.buttonColors(containerColor = if (completed) BentoCardBg else BentoPurplePrimary, contentColor = BentoTextPrimary),
            enabled = !completed,
        ) {
            Text(if (completed) "Completed" else "Mark complete")
        }
    }
}
