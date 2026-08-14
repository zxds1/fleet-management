package com.fleetpulse.app.ui.admin

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.navigation.NavDestination.Companion.hierarchy
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.NavType
import androidx.navigation.compose.*
import androidx.navigation.navArgument
import com.fleetpulse.app.data.ActiveShell
import com.fleetpulse.app.data.Permission
import com.fleetpulse.app.data.repo.FleetRepository
import com.fleetpulse.app.data.remote.SocketClient
import com.fleetpulse.app.ui.components.OfflineBanner
import com.fleetpulse.app.ui.theme.*
import kotlinx.coroutines.launch

private val TITLES = mapOf(
    "home" to "Command Center",
    "live_map" to "Live Map",
    "accidents_console" to "Accident Console",
    "accident_detail" to "Accident Detail",
    "dvir_review" to "DVIR Review",
    "dvir_review_detail" to "DVIR Detail",
    "fuel_reconcile" to "Fuel Reconcile",
    "fuel_purchase_detail" to "Fuel Purchase",
    "statement_import" to "Import Statement",
    "drivers" to "Driver Roster",
    "driver_detail" to "Driver Detail",
    "hardware" to "Hardware Provisioning",
    "vehicles" to "Vehicle Master",
    "vehicle_master" to "Vehicle Detail",
    "privacy" to "Data Requests",
    "trailer" to "Trailer Swap",
    "triggers" to "Alert Triggers",
    "expiring_docs" to "Expiring Documents",
    "document_detail" to "Document Detail",
    "training_review" to "Training Review",
    "vehicle_detail" to "Vehicle Detail",
    "analytics" to "Analytics",
    "maintenance" to "Maintenance",
    "anomaly_detail" to "Anomaly Detail",
    "fuel_card" to "Fuel Card",
    "inspection_detail" to "Inspection Detail",
    "admin_management" to "Admin Management",
    "users" to "Users",
    "user_detail" to "User Detail",
    "outbox" to "Outbox",
    "profile" to "Profile",
    "notifications" to "Notifications",
)

private val DOCK_TABS = listOf(
    Triple("home", "Console", Icons.Filled.Dashboard),
    Triple("live_map", "Map", Icons.Filled.Map),
    Triple("dvir_review", "DVIR", Icons.Filled.Checklist),
    Triple("fuel_reconcile", "Fuel", Icons.Filled.LocalGasStation),
    Triple("drivers", "Drivers", Icons.Filled.People),
    Triple("vehicles", "Vehicles", Icons.Filled.DirectionsCar),
    Triple("privacy", "Data", Icons.Filled.Shield),
    Triple("admin_management", "Admin", Icons.Filled.AdminPanelSettings),
)

@Composable
fun AdminApp(repository: FleetRepository, isConnected: Boolean, pendingCount: Int) {
    val navController = rememberNavController()
    val socketClient = remember { SocketClient(repository) }
    val scope = rememberCoroutineScope()

    DisposableEffect(Unit) {
        socketClient.connect(role = ActiveShell.ADMIN)
        onDispose { socketClient.disconnect() }
    }

    val navBackStack by navController.currentBackStackEntryAsState()
    val currentRoute = navBackStack?.destination?.route?.substringBefore("/") ?: "home"
    val principal by repository.principal.collectAsState()
    val locale = principal?.locale ?: "en"

    Scaffold(
        topBar = {
            Column {
                OfflineBanner(
                    isNetworkConnected = isConnected,
                    pendingQueueCount = pendingCount,
                    onOpenOutbox = { navController.navigate("outbox") },
                    modifier = Modifier.testTag("offline_banner"),
                )
                Surface(color = BentoCardBg, tonalElevation = 2.dp) {
                    Row(
                        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(
                            TITLES[currentRoute] ?: "Admin",
                            style = MaterialTheme.typography.titleMedium,
                            color = BentoTextPrimary,
                            modifier = Modifier.weight(1f).testTag("topbar_title"),
                        )
                        Switch(
                            checked = isConnected,
                            onCheckedChange = { repository.setNetworkConnected(it) },
                            modifier = Modifier.testTag("network_toggle"),
                            colors = SwitchDefaults.colors(checkedTrackColor = StatusSafe, uncheckedTrackColor = StatusDanger),
                        )
                    }
                }
            }
        },
        bottomBar = {
            NavigationBar(containerColor = BentoCardBg, tonalElevation = 4.dp) {
                DOCK_TABS.forEach { (route, label, icon) ->
                    val selected = currentRoute == route
                    NavigationBarItem(
                        selected = selected,
                        onClick = {
                            navController.navigate(route) {
                                popUpTo(navController.graph.findStartDestination().id) { saveState = true }
                                launchSingleTop = true
                                restoreState = true
                            }
                        },
                        icon = { Icon(icon, contentDescription = label, tint = if (selected) BentoBluePrimary else BentoTextSecondary) },
                        label = { Text(label, color = if (selected) BentoBluePrimary else BentoTextSecondary) },
                    )
                }
            }
        },
    ) { padding ->
        NavHost(
            navController = navController,
            startDestination = "home",
            modifier = Modifier.padding(padding).fillMaxSize(),
        ) {
            composable("home") { DashboardScreen(repository, locale, navController) }
            composable("live_map") { LiveMapScreen(repository, locale, navController) }
            composable("accidents_console") { AccidentConsoleScreen(repository, locale, navController) }
            composable("accident_detail/{id}") {
                AdminAccidentDetailScreen(repository, locale, it.arguments?.getString("id") ?: "", navController)
            }
            composable("dvir_review") { DvirReviewScreen(repository, locale, navController) }
            composable("dvir_review_detail/{id}") {
                AdminDvirReviewDetailScreen(repository, locale, it.arguments?.getString("id") ?: "", navController)
            }
            composable("fuel_reconcile") { FuelReconcileScreen(repository, locale, navController) }
            composable("fuel_purchase_detail/{id}") {
                AdminFuelPurchaseDetailScreen(repository, locale, it.arguments?.getString("id") ?: "", navController)
            }
            composable("statement_import") { StatementImportScreen(repository, locale, navController) }
            composable("drivers") { DriversScreen(repository, locale, navController) }
            composable("driver_detail/{id}") {
                AdminDriverDetailScreen(repository, locale, it.arguments?.getString("id") ?: "", navController)
            }
            composable("hardware") { HardwareProvisioningScreen(repository, locale, navController) }
            composable("triggers") { SettingsTriggersScreen(repository, locale, navController) }
            composable("expiring_docs") { ExpiringDocsScreen(repository, locale, navController) }
            composable("document_detail/{id}") {
                AdminDocumentDetailScreen(repository, locale, it.arguments?.getString("id") ?: "", navController)
            }
            composable("training_review") { TrainingReviewScreen(repository, locale, navController) }
            composable("vehicle_detail/{id}") {
                AdminVehicleDetailScreen(repository, locale, it.arguments?.getString("id") ?: "", navController)
            }
            composable("vehicles") { VehicleManagementScreen(repository, locale, navController) }
            composable("vehicle_master/{id}") {
                VehicleMasterDetailScreen(repository, locale, it.arguments?.getString("id") ?: "", navController)
            }
            composable("privacy") { PrivacyRequestsScreen(repository, locale, navController) }
            composable("trailer") { TrailerSwapScreen(repository, locale, navController) }
            composable("analytics") { AnalyticsReportScreen(repository, locale, navController) }
            composable("maintenance") { MaintenanceScheduleScreen(repository, locale, navController) }
            composable("anomaly_feed") { AnomalyFeedScreen(repository, locale, navController) }
            composable("anomaly_detail/{id}") {
                AdminAnomalyDetailScreen(repository, locale, it.arguments?.getString("id") ?: "", navController)
            }
            composable("inspection_detail/{id}") {
                AdminInspectionDetailScreen(repository, locale, it.arguments?.getString("id") ?: "", navController)
            }
            composable("fuel_card") { AdminFuelCardScreen(repository, locale, navController) }
            composable("training_lesson/{id}") {
                AdminTrainingLessonDetailScreen(repository, locale, it.arguments?.getString("id") ?: "", navController)
            }
            composable("admin_management") { AdminManagementScreen(repository, locale, navController) }
            composable("users") { UsersScreen(repository, locale, navController) }
            composable("user_detail/{id}") {
                UserDetailScreen(repository, locale, it.arguments?.getString("id") ?: "", navController)
            }
            composable("outbox") { OutboxScreen(repository, locale, navController) }
            composable("profile") {
                AdminProfileScreen(repository, locale, navController, onLogout = { scope.launch { socketClient.disconnect(); repository.logout() } })
            }
            composable("notifications") { AdminNotificationsScreen(repository, locale, navController) }
        }
    }
}
