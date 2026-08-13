package com.fleetpulse.app.ui.admin

import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController
import com.fleetpulse.app.data.Permission
import com.fleetpulse.app.data.repo.FleetRepository
import com.fleetpulse.app.ui.theme.*
import kotlinx.coroutines.launch
import java.io.InputStream

@Composable
fun StatementImportScreen(repository: FleetRepository, locale: String, nav: NavController) {
    val principal by repository.principal.collectAsState()
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    var fileName by remember { mutableStateOf<String?>(null) }
    var bytes by remember { mutableStateOf<ByteArray?>(null) }
    var status by remember { mutableStateOf<String?>(null) }

    val picker = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri: Uri? ->
        uri ?: return@rememberLauncherForActivityResult
        val stream: InputStream? = context.contentResolver.openInputStream(uri)
        stream?.use { bs -> bytes = bs.readBytes(); fileName = uri.lastPathSegment ?: "statement.csv" }
    }

    if (principal?.hasPermission(Permission.FUEL_VERIFY) != true) {
        Box(Modifier.fillMaxSize().padding(32.dp), contentAlignment = Alignment.Center) { Text("Permission required to import statements.", color = BentoTextSecondary) }
        return
    }

    Column(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text("Import fuel statement (CSV)", style = MaterialTheme.typography.titleLarge, color = BentoTextPrimary)
        Button(onClick = { picker.launch("text/csv") }, colors = ButtonDefaults.buttonColors(containerColor = BentoCardBg), modifier = Modifier.fillMaxWidth().testTag("pick_csv")) {
            Text("Choose CSV file", color = BentoTextPrimary)
        }
        fileName?.let { AdminRowCard(title = "Selected", subtitle = it, testTag = "selected_file") }
        bytes?.let { AdminRowCard(title = "Size", subtitle = "${it.size} bytes") }

        status?.let { Text(it, color = StatusSafe, style = MaterialTheme.typography.bodySmall) }

        val ready = bytes != null && fileName != null
        Button(
            onClick = {
                scope.launch {
                    status = "Uploading…"
                    repository.importStatement(fileName!!, bytes!!).onSuccess { status = if (locale == "sw") "Imeshapakia." else "Statement imported." }
                        .onFailure { status = errorCopy((it as? com.fleetpulse.app.data.remote.AppException)?.errorCode ?: "UNKNOWN", locale) }
                }
            },
            enabled = ready, colors = ButtonDefaults.buttonColors(containerColor = BentoPurplePrimary),
            modifier = Modifier.fillMaxWidth().testTag("upload_csv"),
        ) { Text(if (locale == "sw") "Pakia" else "Upload") }
    }
}
