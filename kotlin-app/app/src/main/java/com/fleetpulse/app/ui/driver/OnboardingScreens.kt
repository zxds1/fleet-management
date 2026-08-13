package com.fleetpulse.app.ui.driver

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController
import com.fleetpulse.app.ui.components.SectionCard
import com.fleetpulse.app.ui.theme.*

@Composable
fun OnboardingStep1Screen(repository: FleetRepository, nav: NavController, locale: String) {
    var fullName by remember { mutableStateOf("") }
    var licence by remember { mutableStateOf("") }
    var emergency by remember { mutableStateOf("") }
    Column(modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp)) {
        ScreenTitle("Profile Setup (1/4)")
        Spacer(Modifier.height(16.dp))
        SectionCard {
            OutlinedTextField(fullName, { fullName = it }, label = { Text("Full name") }, modifier = Modifier.fillMaxWidth().testTag("onboarding_full_name"), colors = driverFieldColors())
            Spacer(Modifier.height(12.dp))
            OutlinedTextField(licence, { licence = it }, label = { Text("Licence number") }, modifier = Modifier.fillMaxWidth().testTag("onboarding_licence"), colors = driverFieldColors())
            Spacer(Modifier.height(12.dp))
            OutlinedTextField(emergency, { emergency = it }, label = { Text("Emergency contact") }, modifier = Modifier.fillMaxWidth().testTag("onboarding_emergency"), colors = driverFieldColors())
        }
        Spacer(Modifier.height(20.dp))
        Button(onClick = { nav.navigate("onboarding_step2") }, modifier = Modifier.fillMaxWidth().height(52.dp).testTag("onboarding_step1_next"), colors = ButtonDefaults.buttonColors(containerColor = BentoPurplePrimary)) {
            Text("Continue")
        }
    }
}

@Composable
fun OnboardingStep2Screen(repository: FleetRepository, nav: NavController, locale: String) {
    var ssn by remember { mutableStateOf("") }
    var dob by remember { mutableStateOf("") }
    var consent by remember { mutableStateOf(false) }
    Column(modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp)) {
        ScreenTitle("Background Check (2/4)")
        Spacer(Modifier.height(16.dp))
        SectionCard {
            OutlinedTextField(ssn, { ssn = it }, label = { Text("SSN (encrypted)") }, modifier = Modifier.fillMaxWidth().testTag("onboarding_ssn"), colors = driverFieldColors())
            Spacer(Modifier.height(12.dp))
            OutlinedTextField(dob, { dob = it }, label = { Text("Date of birth (YYYY-MM-DD)") }, modifier = Modifier.fillMaxWidth().testTag("onboarding_dob"), colors = driverFieldColors())
            Spacer(Modifier.height(12.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Checkbox(consent, { consent = it })
                Text("I consent to the investigative report", color = BentoTextPrimary)
            }
        }
        Spacer(Modifier.height(20.dp))
        Button(onClick = { nav.navigate("onboarding_step3") }, modifier = Modifier.fillMaxWidth().height(52.dp).testTag("onboarding_step2_next"), colors = ButtonDefaults.buttonColors(containerColor = BentoPurplePrimary)) {
            Text("Continue")
        }
        Spacer(Modifier.height(8.dp))
        BackButton({ nav.popBackStack() }, locale)
    }
}

@Composable
fun OnboardingStep3Screen(repository: FleetRepository, nav: NavController, locale: String) {
    val vehicles by repository.vehicles.collectAsState()
    val assigned = vehicles.firstOrNull()
    Column(modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp)) {
        ScreenTitle("Vehicle Assignment (3/4)")
        Spacer(Modifier.height(16.dp))
        SectionCard {
            if (assigned != null) {
                Text("Assigned: ${assigned.plateNumber}", style = MaterialTheme.typography.titleMedium, color = BentoTextPrimary)
                Text("Model: ${assigned.model}", style = MaterialTheme.typography.bodyMedium, color = BentoTextSecondary)
            } else {
                Text("No vehicle assigned yet — dispatch will allocate one.", color = BentoTextSecondary)
            }
        }
        Spacer(Modifier.height(20.dp))
        Button(onClick = { nav.navigate("onboarding_step4") }, modifier = Modifier.fillMaxWidth().height(52.dp).testTag("onboarding_step3_next"), colors = ButtonDefaults.buttonColors(containerColor = BentoPurplePrimary)) {
            Text("Accept")
        }
        Spacer(Modifier.height(8.dp))
        BackButton({ nav.popBackStack() }, locale)
    }
}

@Composable
fun OnboardingStep4Screen(repository: FleetRepository, nav: NavController, locale: String) {
    val principal by repository.principal.collectAsState()
    Column(modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp)) {
        ScreenTitle("Ready to Drive (4/4)")
        Spacer(Modifier.height(16.dp))
        SectionCard {
            Text("Driver: ${principal?.email ?: "—"}", style = MaterialTheme.typography.titleMedium, color = BentoTextPrimary)
            Spacer(Modifier.height(6.dp))
            Text("Profile, background check and vehicle assignment are complete. You're cleared to start driving.", style = MaterialTheme.typography.bodyMedium, color = BentoTextSecondary)
        }
        Spacer(Modifier.height(20.dp))
        Button(onClick = { nav.navigate("home") { popUpTo("home") { inclusive = true } } }, modifier = Modifier.fillMaxWidth().height(52.dp).testTag("onboarding_step4_start"), colors = ButtonDefaults.buttonColors(containerColor = BentoPurplePrimary)) {
            Text("Start Driving")
        }
    }
}
