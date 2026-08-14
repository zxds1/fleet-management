package com.fleetpulse.app.ui.driver

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CameraAlt
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.fleetpulse.app.data.FuelGaugeLevel
import com.fleetpulse.app.ui.theme.*

/**
 * A captured photo backed by real bytes (from camera/gallery). [bytes] is null until captured, then
 * uploaded via [com.fleetpulse.app.data.repo.FleetRepository.uploadMedia] by the calling screen.
 */
data class CapturedPhoto(val bytes: ByteArray, val contentType: String = "image/jpeg") {
    override fun equals(other: Any?): Boolean = other is CapturedPhoto && bytes.contentEquals(other.bytes)
    override fun hashCode(): Int = bytes.contentHashCode()
}

@Composable
fun PhotoCaptureField(
    label: String,
    required: Boolean,
    photo: CapturedPhoto?,
    onCapture: (CapturedPhoto) -> Unit,
    testTag: String,
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        uri ?: return@rememberLauncherForActivityResult
        runCatching {
            context.contentResolver.openInputStream(uri)?.use { it.readBytes() }?.let {
                onCapture(CapturedPhoto(it, "image/jpeg"))
            }
        }
    }
    Column(modifier.fillMaxWidth()) {
        Text(label + if (required) " *" else "", style = MaterialTheme.typography.bodyMedium, color = BentoTextSecondary)
        Spacer(Modifier.height(6.dp))
        Surface(
            onClick = { launcher.launch("image/*") },
            color = BentoBackground,
            shape = RoundedCornerShape(12.dp),
            border = androidx.compose.foundation.BorderStroke(1.dp, if (photo != null) StatusSafe else BentoBorder),
            modifier = Modifier.fillMaxWidth().height(120.dp).testTag(testTag),
        ) {
            Box(contentAlignment = Alignment.Center) {
                if (photo != null) {
                    val bmp = remember(photo) { BitmapFactory.decodeByteArray(photo.bytes, 0, photo.bytes.size) }
                    if (bmp != null) {
                        androidx.compose.foundation.Image(
                            bitmap = bmp.asImageBitmap(),
                            contentDescription = null,
                            modifier = Modifier.fillMaxSize().clip(RoundedCornerShape(12.dp)),
                        )
                    } else {
                        Text("Captured", color = StatusSafe)
                    }
                } else {
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Icon(Icons.Filled.CameraAlt, contentDescription = null, tint = BentoTextSecondary)
                        Spacer(Modifier.height(4.dp))
                        Text("Tap to capture", style = MaterialTheme.typography.bodySmall, color = BentoTextSecondary)
                    }
                }
            }
        }
    }
}

@Composable
fun GaugeSelector(selected: FuelGaugeLevel, onSelect: (FuelGaugeLevel) -> Unit, testTagPrefix: String) {
    val gauges = FuelGaugeLevel.values()
    Row(Modifier.fillMaxWidth().wrapContentHeight(), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        gauges.forEach { g ->
            val sel = g == selected
            Button(
                onClick = { onSelect(g) },
                modifier = Modifier.weight(1f).testTag("$testTagPrefix-${g.name}"),
                colors = ButtonDefaults.buttonColors(
                    containerColor = if (sel) BentoBluePrimary else BentoCardBg,
                    contentColor = if (sel) BentoTextPrimary else BentoTextPrimary,
                ),
                contentPadding = PaddingValues(horizontal = 4.dp, vertical = 8.dp),
            ) { Text(g.name.replace("_", " "), style = MaterialTheme.typography.bodySmall) }
        }
    }
}

@Composable
fun BackButton(onBack: () -> Unit, locale: String) {
    TextButton(onClick = onBack) { Text("← " + t(locale, "common.back"), color = BentoBluePrimary) }
}

@Composable
fun ScreenTitle(title: String) {
    Text(title, style = MaterialTheme.typography.titleLarge, color = BentoTextPrimary)
}

@Composable
fun driverFieldColors() = OutlinedTextFieldDefaults.colors(
    focusedBorderColor = BentoBluePrimary,
    unfocusedBorderColor = BentoBorder,
    focusedTextColor = BentoTextPrimary,
    unfocusedTextColor = BentoTextPrimary,
    cursorColor = BentoBluePrimary,
    focusedLabelColor = BentoTextSecondary,
    unfocusedLabelColor = BentoTextSecondary,
)
