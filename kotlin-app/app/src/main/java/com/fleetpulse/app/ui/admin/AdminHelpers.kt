package com.fleetpulse.app.ui.admin

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.fleetpulse.app.data.VehicleDisplayState
import com.fleetpulse.app.ui.components.StatusChip
import com.fleetpulse.app.ui.theme.*

/** Plain-language copy keyed by error_code (CONTRACTS.md § error codes). */
fun errorCopy(code: String, locale: String): String {
    val en = mapOf(
        "UNAUTHENTICATED" to "Your session expired. Please sign in again.",
        "FORBIDDEN" to "You don't have permission to do that.",
        "NOT_FOUND" to "That record could not be found.",
        "VALIDATION_ERROR" to "Some details are invalid. Please review and retry.",
        "RATE_LIMITED" to "Too many requests. Please wait a moment.",
        "SERVICE_UNAVAILABLE" to "The server is temporarily unavailable. Try again shortly.",
        "IDEMPOTENCY_CONFLICT" to "This action was already completed.",
        "ODOMETER_DECREASED" to "Odometer reading is lower than the last recorded value.",
        "DEFECTS_NOT_REVIEWED" to "Outstanding defects must be reviewed first.",
        "CONSENT_REQUIRED" to "Consent is required before continuing.",
        "ACCOUNT_SUSPENDED" to "This account has been suspended.",
        "DEVICE_REVOKED" to "This device has been revoked. Contact an admin.",
        "TRACKER_ALREADY_PAIRED" to "This tracker is already paired to another vehicle.",
        "VEHICLE_ALREADY_HAS_TRACKER" to "This vehicle already has a tracker. Unpair it first.",
    )
    val sw = mapOf(
        "UNAUTHENTICATED" to "Kipindi chako kimeisha. Tafadhali ingia tena.",
        "FORBIDDEN" to "Huna ruhusa ya kufanya hivyo.",
        "NOT_FOUND" to "Rekodi hiyo haikupatikana.",
        "VALIDATION_ERROR" to "Baadhi ya maelezo hayana usahihi.",
        "RATE_LIMITED" to "Maombi mengi mno. Tafadhali subiri kidogo.",
        "SERVICE_UNAVAILABLE" to "Seva haipatikani kwa sasa. Jaribu tena.",
        "IDEMPOTENCY_CONFLICT" to "Kitendo hiki kimekwisha kukamilika.",
        "ODOMETER_DECREASED" to "Soma ya odometer ni chini kuliko ya awali.",
        "DEFECTS_NOT_REVIEWED" to "Kwanza kagua kasoro zilizobaki.",
        "CONSENT_REQUIRED" to "Idhini inahitajika kabla ya kuendelea.",
        "ACCOUNT_SUSPENDED" to "Akaunti hii imezimwa.",
        "DEVICE_REVOKED" to "Kifaa hiki kimefutwa. Wasiliana na msimamizi.",
        "TRACKER_ALREADY_PAIRED" to "Tracker hii tayari imeunganishwa na gari lingine.",
        "VEHICLE_ALREADY_HAS_TRACKER" to "Gari hili tayari lina tracker. Ondoa kwanza.",
    )
    val map = if (locale == "sw") sw else en
    return map[code] ?: "Something went wrong. Please try again."
}

/** Hardware-provisioning i18n (backend /admin/hardware contract). */
fun t(locale: String, key: String): String {
    val en = mapOf(
        "hw.title" to "Hardware Provisioning",
        "hw.liveness" to "Tracker liveness board",
        "hw.emptyTitle" to "No trackers paired",
        "hw.emptyMessage" to "Pair a physical tracker to a vehicle to begin.",
        "hw.unpair" to "Unpair",
        "hw.unpaired" to "Tracker unpaired.",
        "hw.pairTitle" to "Pair new tracker",
        "hw.noVehicles" to "No vehicles available to pair.",
        "hw.pairAction" to "Pair",
        "hw.pairNew" to "Pair tracker",
    )
    val sw = mapOf(
        "hw.title" to "Utayarishaji wa Vifaa",
        "hw.liveness" to "Bodi ya hali ya tracker",
        "hw.emptyTitle" to "Hakuna tracker iliyounganishwa",
        "hw.emptyMessage" to "Unganisha tracker kwa gari ili kuanza.",
        "hw.unpair" to "Tenganisha",
        "hw.unpaired" to "Tracker imeondolewa.",
        "hw.pairTitle" to "Unganisha tracker mpya",
        "hw.noVehicles" to "Hakuna magari ya kuunganisha.",
        "hw.pairAction" to "Unganisha",
        "hw.pairNew" to "Unganisha tracker",
    )
    val map = if (locale == "sw") sw else en
    return map[key] ?: key
}

@Composable
fun stateColorChip(state: VehicleDisplayState): Pair<String, Color> = when (state) {
    VehicleDisplayState.QUARANTINED -> "QUARANTINED" to StateQuarantined
    VehicleDisplayState.OFFLINE -> "OFFLINE" to StateOffline
    VehicleDisplayState.HOS_ALERT -> "HOS ALERT" to StateHosAlert
    VehicleDisplayState.SPEEDING -> "SPEEDING" to StateSpeeding
    VehicleDisplayState.MOVING -> "MOVING" to StateMoving
    VehicleDisplayState.IDLING -> "IDLING" to StateIdling
    VehicleDisplayState.PARKED -> "PARKED" to StateParked
}

@Composable
fun KpiCard(label: String, value: String, icon: ImageVector, color: Color, modifier: Modifier = Modifier, testTag: String = "") {
    Card(
        colors = CardDefaults.cardColors(containerColor = BentoCardBg),
        shape = RoundedCornerShape(20.dp),
        border = androidx.compose.foundation.BorderStroke(1.dp, BentoBorder),
        modifier = modifier.fillMaxWidth().testTag(testTag),
    ) {
        Column(Modifier.padding(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Icon(icon, null, tint = color, modifier = Modifier.size(20.dp))
                Text(label, style = MaterialTheme.typography.bodySmall, color = BentoTextSecondary)
            }
            Spacer(Modifier.height(8.dp))
            Text(value, style = MaterialTheme.typography.titleLarge, color = BentoTextPrimary, fontWeight = FontWeight.Bold)
        }
    }
}

@Composable
fun AdminListScaffold(
    locale: String,
    emptyIcon: ImageVector,
    emptyTitle: String,
    emptyMessage: String,
    isEmpty: Boolean,
    content: LazyListScope.() -> Unit,
) {
    if (isEmpty) {
        com.fleetpulse.app.ui.components.EmptyState(icon = emptyIcon, title = emptyTitle, message = emptyMessage)
    } else {
        LazyColumn(
            modifier = Modifier.fillMaxSize().padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
            content = content,
        )
    }
}

@Composable
fun AdminRowCard(
    title: String,
    subtitle: String? = null,
    trailing: String? = null,
    onClick: (() -> Unit)? = null,
    modifier: Modifier = Modifier,
    testTag: String = "",
) {
    val shape = RoundedCornerShape(16.dp)
    Surface(
        color = BentoCardBg,
        shape = shape,
        border = androidx.compose.foundation.BorderStroke(1.dp, BentoBorder),
        modifier = modifier.fillMaxWidth().then(if (onClick != null) Modifier.clickable { onClick.invoke() } else Modifier).testTag(testTag),
    ) {
        Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(title, style = MaterialTheme.typography.bodyLarge, color = BentoTextPrimary, fontWeight = FontWeight.SemiBold)
                if (subtitle != null) Text(subtitle, style = MaterialTheme.typography.bodySmall, color = BentoTextSecondary)
            }
            if (trailing != null) {
                Spacer(Modifier.width(8.dp))
                Text(trailing, style = MaterialTheme.typography.labelMedium, color = BentoBluePrimary)
            }
        }
    }
}
