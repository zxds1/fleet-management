package com.fleetpulse.app.ui.driver

import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.navigation.NavDestination.Companion.hierarchy
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.NavType
import androidx.navigation.compose.*
import androidx.navigation.navArgument
import com.fleetpulse.app.data.repo.FleetRepository
import com.fleetpulse.app.ui.components.OfflineBanner
import com.fleetpulse.app.ui.theme.*

/**
 * Driver shell entry point. Hosts the NavHost, an offline banner + top header, and a bottom nav bar.
 * MainActivity already wraps this in FleetPulseTheme — do NOT apply another MaterialTheme here.
 */
@Composable
fun DriverApp(repository: FleetRepository, isConnected: Boolean, pendingCount: Int) {
    val navController = rememberNavController()
    val queueItems by repository.queueItems.collectAsState()
    val pending = queueItems.count { it.status.name == "PENDING" || it.status.name == "FAILED_REVIEW" || it.status.name == "INFLIGHT" }
    val locale = repository.principal.collectAsState().value?.locale ?: "en"

    val items = listOf(
        BottomNavItem("home", Icons.Filled.Home, t(locale, "nav.home")),
        BottomNavItem("refuel", Icons.Filled.LocalGasStation, t(locale, "nav.refuel")),
        BottomNavItem("inspection", Icons.Filled.FactCheck, t(locale, "nav.dvir")),
        BottomNavItem("accidents", Icons.Filled.Warning, t(locale, "nav.mayday"), danger = true),
        BottomNavItem("outbox", Icons.Filled.CloudUpload, t(locale, "nav.outbox")),
        BottomNavItem("profile", Icons.Filled.Person, t(locale, "nav.profile")),
    )

    Scaffold(
        topBar = {
            Column {
                OfflineBanner(
                    isNetworkConnected = isConnected,
                    pendingQueueCount = pending,
                    onOpenOutbox = { navController.navigate("outbox") },
                )
                TopBarHeader(title = t(locale, "app.title"), subtitle = t(locale, "app.driverShell"))
            }
        },
        bottomBar = {
            NavigationBar(containerColor = BentoCardBg, contentColor = BentoTextPrimary) {
                val navBackStackEntry by navController.currentBackStackEntryAsState()
                val current = navBackStackEntry?.destination
                items.forEach { item ->
                    NavigationBarItem(
                        icon = { Icon(item.icon, contentDescription = item.label) },
                        label = { Text(item.label, style = MaterialTheme.typography.labelMedium) },
                        selected = current?.hierarchy?.any { it.route == item.route } == true,
                        onClick = {
                            navController.navigate(item.route) {
                                popUpTo(navController.graph.findStartDestination().id) { saveState = true }
                                launchSingleTop = true
                                restoreState = true
                            }
                        },
                        colors = NavigationBarItemDefaults.colors(
                            selectedIconColor = BentoBluePrimary,
                            selectedTextColor = BentoBluePrimary,
                            unselectedIconColor = BentoTextSecondary,
                            unselectedTextColor = BentoTextSecondary,
                            indicatorColor = BentoBluePrimaryContainer,
                        ),
                    )
                }
            }
        },
    ) { innerPadding ->
        NavHost(
            navController = navController,
            startDestination = "home",
            modifier = Modifier.padding(innerPadding),
        ) {
            composable("home") { DriverHomeScreen(repository, navController, locale) }
            composable("clock_in") { ClockInScreen(repository, navController, locale) }
            composable("clock_out") { ClockOutScreen(repository, navController, locale) }
            composable("refuel") { RefuelScreen(repository, navController, locale) }
            composable("fuel_history") { FuelHistoryScreen(repository, navController, locale) }
            composable(
                "fuel_correction/{purchaseId}",
                arguments = listOf(navArgument("purchaseId") { type = NavType.StringType }),
            ) { back -> FuelCorrectionScreen(repository, navController, locale, back.arguments?.getString("purchaseId") ?: "") }
            composable("inspection") { InspectionScreen(repository, navController, locale) }
            composable("dvir_list") { DvirListScreen(repository, navController, locale) }
            composable(
                "dvir_detail/{id}",
                arguments = listOf(navArgument("id") { type = NavType.StringType }),
            ) { back -> DvirDetailScreen(repository, navController, locale, back.arguments?.getString("id") ?: "") }
            composable("accidents") { AccidentsScreen(repository, navController, locale) }
            composable("my_accidents") { MyAccidentsScreen(repository, navController, locale) }
            composable(
                "driver_accident_detail/{id}",
                arguments = listOf(navArgument("id") { type = NavType.StringType }),
            ) { back -> DriverAccidentDetailScreen(repository, navController, locale, back.arguments?.getString("id") ?: "") }
            composable("anomalies") { AnomaliesScreen(repository, navController, locale) }
            composable("notifications") { NotificationsScreen(repository, navController, locale) }
            composable("my_shifts") { MyShiftsScreen(repository, navController, locale) }
            composable("driver_documents") { DriverDocumentsScreen(repository, navController, locale) }
            composable("onboarding_step1") { OnboardingStep1Screen(repository, navController, locale) }
            composable("onboarding_step2") { OnboardingStep2Screen(repository, navController, locale) }
            composable("onboarding_step3") { OnboardingStep3Screen(repository, navController, locale) }
            composable("onboarding_step4") { OnboardingStep4Screen(repository, navController, locale) }
            composable("training_hub") { TrainingHubScreen(repository, navController, locale) }
            composable(
                "lesson_detail/{id}",
                arguments = listOf(navArgument("id") { type = NavType.StringType }),
            ) { back -> LessonDetailScreen(repository, navController, locale, back.arguments?.getString("id") ?: "") }
            composable("resource_library") { ResourceLibraryScreen(repository, navController, locale) }
            composable("vehicle_state") { VehicleStateScreen(repository, navController, locale) }
            composable("vehicle_map") { VehicleMapScreen(repository, navController, locale) }
            composable("vehicle_issue") { VehicleIssueScreen(repository, navController, locale) }
            composable("outbox") { OutboxScreen(repository, navController, locale, isConnected) }
            composable("profile") { ProfileScreen(repository, navController, locale) }
            composable("suspended") { SuspendedScreen(repository, navController, locale) }
        }
    }
}

private data class BottomNavItem(
    val route: String,
    val icon: androidx.compose.ui.graphics.vector.ImageVector,
    val label: String,
    val danger: Boolean = false,
)

@Composable
fun TopBarHeader(title: String, subtitle: String, modifier: Modifier = Modifier) {
    Surface(color = BentoBackground, modifier = modifier.fillMaxWidth()) {
        Row(modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
            Surface(color = BentoBluePrimary, shape = MaterialTheme.shapes.small, modifier = Modifier.size(36.dp)) {
                Box(contentAlignment = Alignment.Center) { Text("FP", color = BentoTextPrimary, style = MaterialTheme.typography.titleMedium) }
            }
            Spacer(Modifier.width(12.dp))
            Column {
                Text(title, style = MaterialTheme.typography.titleMedium, color = BentoTextPrimary)
                Text(subtitle, style = MaterialTheme.typography.bodySmall, color = BentoTextSecondary)
            }
        }
    }
}

/** In-code i18n map keyed by locale. Centralizes driver-shell copy (en + sw). */
fun t(locale: String, key: String): String {
    val map = if (locale == "sw") SW else EN
    return map[key] ?: EN[key] ?: key
}

private val EN = mapOf(
    "app.title" to "FleetPulse",
    "app.driverShell" to "Driver Console",
    "nav.home" to "Home",
    "nav.refuel" to "Refuel",
    "nav.dvir" to "DVIR",
    "nav.mayday" to "Mayday",
    "nav.outbox" to "Outbox",
    "nav.profile" to "Profile",
    "common.back" to "Back",
    "common.cancel" to "Cancel",
    "common.retry" to "Retry",
    "common.discard" to "Discard",
    "common.loading" to "Loading…",
    "common.empty" to "Nothing here yet",
    "common.pending" to "Pending",
    "home.greeting" to "Welcome back",
    "home.clockIn" to "Clock In",
    "home.clockOut" to "Clock Out",
    "home.noActiveShift" to "No active shift",
    "home.quickActions" to "Quick Actions",
    "tabs.refuel" to "Refuel",
    "tabs.inspect" to "DVIR",
    "tabs.accidents" to "Accidents",
    "tabs.training" to "Training",
    "tabs.resources" to "Resources",
    "tabs.anomalies" to "Anomalies",
    "vehicle.title" to "My Vehicle",
    "vehicle.mapTitle" to "Vehicle Map",
    "profile.title" to "Profile",
    "outbox.title" to "Outbox",
    "anomalies.title" to "Anomalies",
    "notifications.title" to "Notifications",
    "myShifts.title" to "My Shifts",
    "documents.title" to "Documents",
    "training.title" to "Training Hub",
    "lesson.title" to "Lesson",
    "resources.title" to "Resource Library",
    "inspection.title" to "DVIR Inspection",
    "fuelHistory.title" to "Fuel History",
    "fuelCorrection.title" to "Correct Purchase",
    "dvirList.title" to "Inspections",
    "accidents.title" to "Accidents & Mayday",
    "myAccidents.title" to "My Accidents",
    "suspended.title" to "Account Suspended",
)

private val SW = mapOf(
    "app.title" to "FleetPulse",
    "app.driverShell" to "Kiwanda cha Dereva",
    "nav.home" to "Mwanzo",
    "nav.refuel" to "Mafuta",
    "nav.dvir" to "DKP",
    "nav.mayday" to "Tahadhari",
    "nav.outbox" to "Sanduku",
    "nav.profile" to "Wasifu",
    "common.back" to "Rudi",
    "common.cancel" to "Ghairi",
    "common.retry" to "Jaribu tena",
    "common.discard" to "Ondoa",
    "common.loading" to "Inapakia…",
    "common.empty" to "Hakuna kitu hapa bado",
    "common.pending" to "Inasubiri",
    "home.greeting" to "Karibu tena",
    "home.clockIn" to "Ingia Kazi",
    "home.clockOut" to "Toka Kazini",
    "home.noActiveShift" to "Hakuna zamu ya kazini",
    "home.quickActions" to "Vitendo vya Haraka",
    "tabs.refuel" to "Mafuta",
    "tabs.inspect" to "DKP",
    "tabs.accidents" to "Ajali",
    "tabs.training" to "Mafunzo",
    "training.title" to "Kituo cha Mafunzo",
    "tabs.resources" to "Rasilimali",
    "tabs.anomalies" to "Hitilafu",
    "vehicle.title" to "Gari Langu",
    "vehicle.mapTitle" to "Ramani ya Gari",
    "profile.title" to "Wasifu",
    "outbox.title" to "Sanduku la Nje ya Mtandao",
    "anomalies.title" to "Hitilafu",
    "notifications.title" to "Arifa",
    "myShifts.title" to "Zamu Zangu",
    "documents.title" to "Nyaraka",
    "lesson.title" to "Somo",
    "resources.title" to "Maktaba ya Rasilimali",
    "inspection.title" to "Ukaguzi wa DKP",
    "fuelHistory.title" to "Historia ya Mafuta",
    "fuelCorrection.title" to "Sahihisha Ununuzi",
    "dvirList.title" to "Ukaguzi",
    "accidents.title" to "Ajali na Tahadhari",
    "myAccidents.title" to "Ajali Zangu",
    "suspended.title" to "Akaunti Imependwa",
)
