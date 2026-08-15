/** Mirror of kotlin-app/.../data/Constants.kt. */
export const AppConstants = {
  CURRENCY_CODE: "KES",
  CURRENCY_SYMBOL: "Ksh",
  SAMPLE_PHONE_HINT: "+254712345678",
  INVITE_ROLES: ["FLEET_MANAGER", "ADMIN"] as const,
  VEHICLE_ISSUE_CATEGORIES: ["MECHANICAL", "ELECTRICAL", "TIRE", "BRAKES", "BODY", "OTHER"],
  VEHICLE_ISSUE_SEVERITIES: ["INFO", "WARNING", "CRITICAL"],
  VEHICLE_STATUSES: ["AVAILABLE", "IN_USE", "MAINTENANCE", "QUARANTINED", "RETIRED", "EXTERNAL"],
  VEHICLE_CLASSES: ["TRACTOR", "RIGID", "VAN", "PICKUP"],
  APP_LOCALES: [
    { code: "en", label: "English" },
    { code: "sw", label: "Kiswahili" },
  ],
} as const;

