package com.fleetpulse.app.ui.auth

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AdminPanelSettings
import androidx.compose.material.icons.filled.DirectionsCar
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.fleetpulse.app.data.ActiveShell
import com.fleetpulse.app.data.availableShells
import com.fleetpulse.app.data.repo.FleetRepository
import com.fleetpulse.app.ui.components.FleetButton
import com.fleetpulse.app.ui.theme.*

/**
 * Shell picker shown ONLY for a mixed principal that holds BOTH shells (CONTRACTS.md: mixed →
 * role picker). Pure drivers and pure admins never see this — MainActivity routes them directly from
 * their single available shell. Selecting a shell calls `repository.setActiveShell(...)`.
 */
@Composable
fun RoleSwitchScreen(
    repository: FleetRepository,
    onShellChosen: (ActiveShell) -> Unit = {},
) {
    val principal by repository.principal.collectAsState()
    val locale = principal?.locale ?: "en"
    val shells = principal?.availableShells().orEmpty()

    var selected by remember(shells) { mutableStateOf(shells.firstOrNull() ?: ActiveShell.DRIVER) }

    AuthScaffold(
        title = AuthStrings.roleSwitchTitle(locale),
        subtitle = AuthStrings.roleSwitchSubtitle(locale),
        modifier = Modifier.testTag("role_switch_screen"),
    ) {
        if (ActiveShell.DRIVER in shells) {
            ShellOptionCard(
                icon = Icons.Default.DirectionsCar,
                title = AuthStrings.driverShell(locale),
                description = AuthStrings.driverShellDesc(locale),
                selected = selected == ActiveShell.DRIVER,
                onSelect = { selected = ActiveShell.DRIVER },
                testTag = "role_driver_option",
            )
            Spacer(Modifier.height(12.dp))
        }
        if (ActiveShell.ADMIN in shells) {
            ShellOptionCard(
                icon = Icons.Default.AdminPanelSettings,
                title = AuthStrings.adminShell(locale),
                description = AuthStrings.adminShellDesc(locale),
                selected = selected == ActiveShell.ADMIN,
                onSelect = { selected = ActiveShell.ADMIN },
                testTag = "role_admin_option",
            )
        }

        Spacer(Modifier.height(24.dp))
        FleetButton(
            text = AuthStrings.continueBtn(locale),
            onClick = {
                repository.setActiveShell(selected)
                onShellChosen(selected)
            },
            modifier = Modifier.testTag("role_continue_btn"),
        )
    }
}

@Composable
private fun ShellOptionCard(
    icon: ImageVector,
    title: String,
    description: String,
    selected: Boolean,
    onSelect: () -> Unit,
    testTag: String,
) {
    Card(
        colors = CardDefaults.cardColors(
            containerColor = if (selected) BentoPurpleContainer else BentoCardBg,
        ),
        shape = RoundedCornerShape(20.dp),
        border = BorderStroke(1.dp, if (selected) BentoPurplePrimary else BentoBorder),
        modifier = Modifier
            .fillMaxWidth()
            .selectable(selected = selected, onClick = onSelect)
            .testTag(testTag),
    ) {
        Row(
            modifier = Modifier.padding(16.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Icon(icon, contentDescription = null, tint = BentoPurplePrimary, modifier = Modifier.size(28.dp))
            Column(Modifier.weight(1f)) {
                Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, color = BentoTextPrimary)
                Spacer(Modifier.height(2.dp))
                Text(description, style = MaterialTheme.typography.bodySmall, color = BentoTextSecondary)
            }
            RadioButton(
                selected = selected,
                onClick = onSelect,
                colors = RadioButtonDefaults.colors(selectedColor = BentoPurplePrimary, unselectedColor = BentoTextSecondary),
            )
        }
    }
}
