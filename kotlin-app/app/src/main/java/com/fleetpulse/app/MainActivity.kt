package com.fleetpulse.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Surface
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import com.fleetpulse.app.app.FleetApplication
import com.fleetpulse.app.data.ActiveShell
import com.fleetpulse.app.data.repo.FleetRepository
import com.fleetpulse.app.ui.auth.*
import com.fleetpulse.app.ui.driver.*
import com.fleetpulse.app.ui.admin.*
import com.fleetpulse.app.ui.components.OfflineBanner
import com.fleetpulse.app.ui.theme.FleetPulseTheme
import com.fleetpulse.app.ui.theme.BentoBackground

class MainActivity : ComponentActivity() {
    private val repository: FleetRepository by lazy { (application as FleetApplication).repository }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            FleetPulseTheme {
                val authState by repository.authState.collectAsState()
                val principal by repository.principal.collectAsState()
                val activeShell by repository.activeShell.collectAsState()
                val isConnected by repository.isNetworkConnected.collectAsState()
                val queueItems by repository.queueItems.collectAsState()
                val pendingCount = queueItems.count { it.status.name == "PENDING" || it.status.name == "FAILED_REVIEW" || it.status.name == "INFLIGHT" }

                Surface(modifier = Modifier.fillMaxSize(), color = BentoBackground) {
                    when {
                        authState is FleetRepository.AuthState.Unauthenticated ||
                            authState is FleetRepository.AuthState.Error -> {
                            AuthRoot(repository = repository)
                        }
                        authState is FleetRepository.AuthState.NeedsMfa -> {
                            MfaScreen(repository = repository)
                        }
                        authState is FleetRepository.AuthState.NeedsConsent -> {
                            ConsentScreen(repository = repository)
                        }
                        principal != null && activeShell != null -> {
                            if (activeShell == ActiveShell.ADMIN) {
                                AdminRoot(repository = repository, isConnected = isConnected, pendingCount = pendingCount)
                            } else {
                                DriverRoot(repository = repository, isConnected = isConnected, pendingCount = pendingCount)
                            }
                        }
                        else -> LoadingSplash()
                    }
                }
            }
        }
    }
}

@Composable
private fun LoadingSplash() {
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        CircularProgressIndicator(color = com.fleetpulse.app.ui.theme.BentoPurplePrimary)
    }
}

/**
 * Root composable for the driver shell: a NavHost with every driver screen. The driver realtime is
 * HTTP polling (docs/backend/07 §1); admin uses Socket.IO. The OfflineBanner shows whenever there are
 * pending/FAILED_REVIEW queue items or connectivity is down.
 */
@Composable
fun DriverRoot(repository: FleetRepository, isConnected: Boolean, pendingCount: Int) {
    DriverApp(repository = repository, isConnected = isConnected, pendingCount = pendingCount)
}

@Composable
fun AdminRoot(repository: FleetRepository, isConnected: Boolean, pendingCount: Int) {
    AdminApp(repository = repository, isConnected = isConnected, pendingCount = pendingCount)
}
