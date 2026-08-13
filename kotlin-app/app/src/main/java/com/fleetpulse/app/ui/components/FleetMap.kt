package com.fleetpulse.app.ui.components

import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import com.fleetpulse.app.data.Vehicle
import com.fleetpulse.app.data.VehicleDisplayState
import com.fleetpulse.app.ui.theme.*
import com.google.android.gms.maps.CameraUpdateFactory
import com.google.android.gms.maps.model.BitmapDescriptorFactory
import com.google.android.gms.maps.model.CameraPosition
import com.google.android.gms.maps.model.LatLng
import com.google.android.gms.maps.model.LatLngBounds
import com.google.maps.android.compose.*

/** Maps backend display-state precedence to a marker tint color (mirrors N5 precedence). */
fun displayStateMarkerColor(state: VehicleDisplayState): Color = when (state) {
    VehicleDisplayState.QUARANTINED -> StateQuarantined
    VehicleDisplayState.OFFLINE -> StateOffline
    VehicleDisplayState.HOS_ALERT -> StateHosAlert
    VehicleDisplayState.SPEEDING -> StateSpeeding
    VehicleDisplayState.MOVING -> StateMoving
    VehicleDisplayState.IDLING -> StateIdling
    VehicleDisplayState.PARKED -> StateParked
}

@Composable
private fun bitmapDescriptorFromState(state: VehicleDisplayState) =
    BitmapDescriptorFactory.defaultMarker(
        when (displayStateMarkerColor(state)) {
            StateQuarantined -> BitmapDescriptorFactory.HUE_RED
            StateOffline -> BitmapDescriptorFactory.HUE_GRAY
            StateHosAlert -> BitmapDescriptorFactory.HUE_ORANGE
            StateSpeeding -> BitmapDescriptorFactory.HUE_YELLOW
            StateMoving -> BitmapDescriptorFactory.HUE_GREEN
            StateIdling -> BitmapDescriptorFactory.HUE_BLUE
            else -> BitmapDescriptorFactory.HUE_VIOLET
        },
    )

/**
 * Full-screen Google Map rendering every vehicle as a colored marker (precedence colors).
 * Camera auto-fits all points on first load and on position changes. Tapping a marker invokes
 * [onVehicleClick]. Uses maps-compose with the Maps API key injected from the manifest meta-data.
 */
@Composable
fun FullScreenVehicleMap(
    vehicles: List<Vehicle>,
    onVehicleClick: (Vehicle) -> Unit,
    modifier: Modifier = Modifier,
) {
    val positioned = vehicles.filter { it.lat != null && it.lng != null }
    if (positioned.isEmpty()) return

    val cameraPositionState = rememberCameraPositionState {
        val first = positioned.first()
        position = CameraPosition.fromLatLngZoom(LatLng(first.lat!!, first.lng!!), 12f)
    }

    LaunchedEffect(positioned.map { "${it.id}:${it.lat}:${it.lng}" }.joinToString()) {
        val pts = positioned.map { LatLng(it.lat!!, it.lng!!) }
        if (pts.isNotEmpty()) {
            val bounds = LatLngBounds.builder().apply { pts.forEach { include(it) } }.build()
            try {
                cameraPositionState.move(CameraUpdateFactory.newLatLngBounds(bounds, 80))
            } catch (_: Exception) { /* single point or layout not ready yet */ }
        }
    }

    GoogleMap(
        modifier = modifier.fillMaxSize(),
        cameraPositionState = cameraPositionState,
        uiSettings = MapUiSettings(zoomControlsEnabled = true, compassEnabled = true, myLocationButtonEnabled = false),
        properties = MapProperties(mapType = MapType.NORMAL),
    ) {
        positioned.forEach { v ->
            Marker(
                state = MarkerState(position = LatLng(v.lat!!, v.lng!!)),
                title = v.plateNumber,
                snippet = "${v.model} · ${v.displayState.name}",
                onClick = { onVehicleClick(v); true },
                icon = bitmapDescriptorFromState(v.displayState),
            )
        }
    }
}
