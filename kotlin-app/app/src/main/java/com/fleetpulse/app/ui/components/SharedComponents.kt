package com.fleetpulse.app.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.fleetpulse.app.ui.theme.*

@Composable
fun OfflineBanner(
    isNetworkConnected: Boolean,
    pendingQueueCount: Int,
    onOpenOutbox: () -> Unit,
    modifier: Modifier = Modifier,
) {
    if (isNetworkConnected && pendingQueueCount == 0) return
    Surface(
        color = if (isNetworkConnected) BentoBlueContainer else BentoDarkBadge,
        modifier = modifier.fillMaxWidth(),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Icon(
                imageVector = if (isNetworkConnected) Icons.Default.CloudUpload else Icons.Default.CloudOff,
                contentDescription = null,
                tint = if (isNetworkConnected) StatusInfo else StatusWarning,
                modifier = Modifier.size(18.dp),
            )
            Text(
                text = if (isNetworkConnected) "$pendingQueueCount pending write(s) syncing…" else "Offline — writes queued locally",
                style = MaterialTheme.typography.bodySmall,
                color = BentoTextPrimary,
                modifier = Modifier.weight(1f),
            )
            if (pendingQueueCount > 0) {
                TextButton(onClick = onOpenOutbox) {
                    Text("Outbox", color = BentoPurplePrimary)
                }
            }
        }
    }
}

@Composable
fun EmptyState(
    icon: ImageVector,
    title: String,
    message: String,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier.fillMaxSize().padding(32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Icon(imageVector = icon, contentDescription = null, tint = BentoTextSecondary, modifier = Modifier.size(48.dp))
        Spacer(Modifier.height(12.dp))
        Text(title, style = MaterialTheme.typography.titleMedium, color = BentoTextPrimary)
        Spacer(Modifier.height(6.dp))
        Text(message, style = MaterialTheme.typography.bodyMedium, color = BentoTextSecondary)
    }
}

@Composable
fun ErrorState(
    message: String,
    onRetry: (() -> Unit)? = null,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier.fillMaxSize().padding(32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Icon(imageVector = Icons.Default.ErrorOutline, contentDescription = null, tint = StatusDanger, modifier = Modifier.size(48.dp))
        Spacer(Modifier.height(12.dp))
        Text("Something went wrong", style = MaterialTheme.typography.titleMedium, color = BentoTextPrimary)
        Spacer(Modifier.height(6.dp))
        Text(message, style = MaterialTheme.typography.bodyMedium, color = BentoTextSecondary)
        if (onRetry != null) {
            Spacer(Modifier.height(16.dp))
            Button(onClick = onRetry, colors = ButtonDefaults.buttonColors(containerColor = BentoPurplePrimary)) {
                Text("Retry")
            }
        }
    }
}

@Composable
fun LoadingIndicator(modifier: Modifier = Modifier) {
    Box(modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        CircularProgressIndicator(color = BentoPurplePrimary)
    }
}

@Composable
fun FleetButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    isPrimary: Boolean = true,
) {
    Button(
        onClick = onClick,
        enabled = enabled,
        shape = CircleShape,
        colors = ButtonDefaults.buttonColors(
            containerColor = if (isPrimary) BentoPurplePrimary else BentoCardBg,
            contentColor = if (isPrimary) BentoTextPrimary else BentoTextPrimary,
        ),
        modifier = modifier.fillMaxWidth().height(52.dp),
    ) { Text(text, fontWeight = FontWeight.Bold) }
}

@Composable
fun SectionCard(
    modifier: Modifier = Modifier,
    content: @Composable ColumnScope.() -> Unit,
) {
    Card(
        colors = CardDefaults.cardColors(containerColor = BentoCardBg),
        shape = RoundedCornerShape(20.dp),
        border = androidx.compose.foundation.BorderStroke(1.dp, BentoBorder),
        modifier = modifier.fillMaxWidth(),
    ) { Column(Modifier.padding(16.dp), content = content) }
}

@Composable
fun StatusChip(text: String, color: Color, modifier: Modifier = Modifier) {
    Surface(
        color = color.copy(alpha = 0.15f),
        shape = RoundedCornerShape(999.dp),
        modifier = modifier,
    ) {
        Text(
            text = text,
            color = color,
            style = MaterialTheme.typography.labelMedium,
            modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp),
        )
    }
}

/** Renders content only if the principal holds the given permission. */
@Composable
fun PermissionGate(permission: String, has: Boolean, content: @Composable () -> Unit) {
    if (has) content()
}
