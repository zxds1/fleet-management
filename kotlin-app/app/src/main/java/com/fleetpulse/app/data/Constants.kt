package com.fleetpulse.app.data

object AppConstants {
    const val CURRENCY_CODE = "KES"
    const val CURRENCY_SYMBOL = "Ksh"
    const val SAMPLE_PHONE_HINT = "+254712345678"
    val INVITE_ROLES: List<String> = listOf("FLEET_MANAGER", "ADMIN")
    val VEHICLE_ISSUE_CATEGORIES: List<String> = listOf("MECHANICAL", "ELECTRICAL", "TIRE", "BRAKES", "BODY", "OTHER")
    val VEHICLE_ISSUE_SEVERITIES: List<String> = listOf("INFO", "WARNING", "CRITICAL")
    val VEHICLE_STATUSES: List<String> = listOf("AVAILABLE", "IN_USE", "MAINTENANCE", "QUARANTINED", "RETIRED", "EXTERNAL")
    val VEHICLE_CLASSES: List<String> = listOf("TRACTOR", "RIGID", "VAN", "PICKUP")
    val APP_LOCALES: List<Pair<String, String>> = listOf("en" to "English", "sw" to "Kiswahili")
}
