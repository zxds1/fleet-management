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
import com.fleetpulse.app.data.InspectionItem
import com.fleetpulse.app.data.InspectionItemResult
import com.fleetpulse.app.data.InspectionSubject
import com.fleetpulse.app.data.InspectionSeverity
import com.fleetpulse.app.data.repo.FleetRepository
import com.fleetpulse.app.ui.components.SectionCard
import com.fleetpulse.app.ui.theme.*
import kotlinx.coroutines.launch
import java.util.UUID

private data class TemplateItem(val id: String, val category: String, val label: String)

private val DVIR_TEMPLATE = listOf(
    TemplateItem("svc_brakes", "Brakes", "Service Brakes"),
    TemplateItem("tires", "Tires", "Tires & Wheels"),
    TemplateItem("lights", "Lights", "Lights & Signals"),
    TemplateItem("windshield", "Visibility", "Windshield & Wipers"),
    TemplateItem("mirrors", "Visibility", "Mirrors"),
    TemplateItem("emergency", "Safety", "Emergency Equipment"),
)

@Composable
fun InspectionScreen(repository: FleetRepository, nav: NavController, locale: String) {
    val shift by repository.activeShift.collectAsState()
    val vehicles by repository.vehicles.collectAsState()
    val scope = rememberCoroutineScope()

    var results by remember { mutableStateOf(mapOf<String, InspectionItemResult>()) }
    var notes by remember { mutableStateOf(mapOf<String, String>()) }
    var photos by remember { mutableStateOf(mapOf<String, CapturedPhoto>()) }
    var reviewed by remember { mutableStateOf(false) }
    var signature by remember { mutableStateOf("") }
    var localError by remember { mutableStateOf<String?>(null) }
    var submitting by remember { mutableStateOf(false) }
    var done by remember { mutableStateOf(false) }

    val vehicleId = shift?.vehicleId ?: vehicles.firstOrNull()?.id
    val templateId = "default-dvir-template"

    if (done) {
        Column(modifier = Modifier.fillMaxSize().padding(32.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
            Icon(Icons.Filled.CheckCircle, contentDescription = null, tint = StatusSafe, modifier = Modifier.size(64.dp))
            Spacer(Modifier.height(16.dp))
            Text("DVIR submitted", style = MaterialTheme.typography.titleLarge, color = BentoTextPrimary)
            Spacer(Modifier.height(16.dp))
            Button(onClick = { nav.popBackStack() }, colors = ButtonDefaults.buttonColors(containerColor = BentoPurplePrimary)) { Text(t(locale, "common.back")) }
        }
        return
    }

    Column(modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp)) {
        BackButton({ nav.popBackStack() }, locale)
        Spacer(Modifier.height(8.dp))
        ScreenTitle(t(locale, "inspection.title"))
        Spacer(Modifier.height(16.dp))

        DVIR_TEMPLATE.forEach { it ->
            SectionCard(modifier = Modifier.fillMaxWidth().padding(bottom = 12.dp)) {
                Text(it.label, style = MaterialTheme.typography.titleMedium, color = BentoTextPrimary)
                Spacer(Modifier.height(8.dp))
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    InspectionItemResult.values().forEach { r ->
                        Button(
                            onClick = { results = results + (it.id to r) },
                            modifier = Modifier.weight(1f).testTag("dvir_${it.id}_${r.name}"),
                            colors = ButtonDefaults.buttonColors(
                                containerColor = if (results[it.id] == r) BentoPurplePrimary else BentoCardBg,
                                contentColor = if (results[it.id] == r) BentoTextPrimary else BentoTextPrimary,
                            ),
                            contentPadding = PaddingValues(4.dp, 8.dp),
                        ) { Text(r.name.replace("_", " "), style = MaterialTheme.typography.bodySmall) }
                    }
                }
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(
                    value = notes[it.id] ?: "", onValueChange = { notes = notes + (it.id to it) },
                    label = { Text("Notes (required if FAIL)") }, modifier = Modifier.fillMaxWidth(),
                    minLines = 1, colors = driverFieldColors(),
                )
                if (results[it.id] == InspectionItemResult.FAIL) {
                    Spacer(Modifier.height(8.dp))
                    PhotoCaptureField(label = "Defect photo (required)", required = true, photo = photos[it.id], onCapture = { photos = photos + (it.id to it) }, testTag = "dvir_photo_${it.id}")
                }
            }
        }

        SectionCard(modifier = Modifier.fillMaxWidth().padding(bottom = 12.dp)) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Checkbox(checked = reviewed, onCheckedChange = { reviewed = it })
                Text("Previous defects reviewed", color = BentoTextPrimary)
            }
            OutlinedTextField(
                value = signature, onValueChange = { signature = it },
                label = { Text("Signature name") }, modifier = Modifier.fillMaxWidth().testTag("dvir_signature"),
                singleLine = true, colors = driverFieldColors(),
            )
        }

        if (localError != null) {
            Spacer(Modifier.height(8.dp))
            Text(localError!!, color = StatusDanger, style = MaterialTheme.typography.bodyMedium)
        }

        Spacer(Modifier.height(20.dp))
        Button(
            onClick = {
                val missing = DVIR_TEMPLATE.filter { results[it.id] == null }
                when {
                    missing.isNotEmpty() -> localError = "Mark every item PASS / FAIL / N/A"
                    !reviewed -> localError = "Confirm previous defects reviewed"
                    signature.isBlank() -> localError = "Signature required"
                    results.any { it.value == InspectionItemResult.FAIL && photos[it.key] == null } -> localError = "DVIR_FAIL_NEEDS_PHOTO: every FAIL needs a photo"
                    else -> {
                        localError = null
                        submitting = true
                        scope.launch {
                            // Upload fail photos, then enqueue the inspection.
                            val items = DVIR_TEMPLATE.mapNotNull { tpl ->
                                val res = results[tpl.id] ?: return@mapNotNull null
                                val photo = if (res == InspectionItemResult.FAIL) photos[tpl.id] else null
                                val photoId = photo?.let { repository.uploadMedia("INSPECTION_ITEM", "INSPECTION", photo.contentType, photo.bytes) }
                                InspectionItem(
                                    templateItemId = tpl.id, label = tpl.label, category = tpl.category, result = res,
                                    severity = InspectionSeverity.WARNING, notes = notes[tpl.id]?.takeIf { n -> n.isNotBlank() },
                                    photoMediaId = photoId,
                                )
                            }
                            if (shift != null && vehicleId != null) {
                                repository.submitDvir(shift!!.id, templateId, InspectionSubject.VEHICLE.name, vehicleId, items, signature.trim())
                                done = true
                            } else {
                                localError = "No active shift / vehicle to attach DVIR"
                                submitting = false
                            }
                        }
                    }
                }
            },
            enabled = !submitting,
            modifier = Modifier.fillMaxWidth().height(52.dp).testTag("inspection_submit"),
            colors = ButtonDefaults.buttonColors(containerColor = BentoPurplePrimary),
        ) {
            Text(if (submitting) t(locale, "common.pending") else t(locale, "inspection.title"))
        }
    }
}
