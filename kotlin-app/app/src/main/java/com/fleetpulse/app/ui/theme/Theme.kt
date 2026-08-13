package com.fleetpulse.app.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.*

private val FleetDarkScheme = darkColorScheme(
    background = BentoBackground,
    surface = BentoCardBg,
    primary = BentoPurplePrimary,
    onPrimary = BentoTextPrimary,
    onBackground = BentoTextPrimary,
    onSurface = BentoTextPrimary,
    error = StatusDanger,
)

@Composable
fun FleetPulseTheme(
    darkTheme: Boolean = true,
    content: @Composable () -> Unit,
) {
    MaterialTheme(
        colorScheme = FleetDarkScheme,
        typography = FleetTypography,
        content = content,
    )
}
