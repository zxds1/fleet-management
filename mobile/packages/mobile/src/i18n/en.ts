/** B-19 (decided): two languages only. The server localises NOTIFICATION copy (app.notifications.locale)
 *  but knows nothing about the app's own UI copy, so every string the app renders itself must exist in
 *  both dictionaries and test/i18nKeys.test.ts enforces it. The language is the DEVICE locale unless the
 *  driver has chosen one explicitly in Settings, which is remembered on the device. */
export const en = {
  app: { loading: 'Loading', cancel: 'Cancel', },
  auth: { emailOrPhone: 'Email or phone', loginHelp: 'Your phone number or work email, and your password.', chooseExperience: 'How do you want to use Helix?', splashHint: 'Checking your sign-in…', suspendedTitle: 'Account suspended', password: 'Password', logIn: 'Log in', showPassword: 'Show password', hidePassword: 'Hide password', consentTitle: 'GPS tracking consent', accept: 'Accept and continue', decline: 'Decline', suspended: 'Your account is suspended. Contact your fleet admin.', logOut: 'Log out', continueDriver: 'Continue as driver', continueAdmin: 'Continue as admin', mfaCode: 'Code', mfaHelp: 'Enter the 6-digit code we sent you, or one of your recovery codes.', verify: 'Verify', continue: 'Continue', signUp: 'Create company', companyName: 'Company name', forgotPassword: 'Forgot password?', passwordReset: 'Reset password', passwordResetHelp: 'Enter your email or phone to receive a reset code.', passwordResetCode: 'Enter the code and your new password.', passwordResetDone: 'Password reset successful.' },
  nav: { home: 'Home', refuel: 'Refuel', inspect: 'Inspect', accidents: 'Accidents', more: 'More', map: 'Live map', },
  shift: { workPlan: 'Plan for this shift (optional)', clockedIn: 'Clocked in', phoneFallback: 'Share my location', phoneFallbackHelp: 'Helix sends your position while the app is open and you are on shift. Close the app and it stops.', vehicle: 'Vehicle {{plate}}', noAssignmentHint: 'You have no vehicle assigned yet. Ask your admin.', retakePhoto: 'Retake photo', notes: 'Notes (optional)', restUntil: 'Mandatory rest until {{time}}', clockIn: 'Clock in', clockOut: 'Clock out', noShift: 'No active shift', onDuty: 'On duty since {{time}}', odometer: 'Odometer (km)', photo: 'Photo of odometer and fuel gauge', assignment: 'Assignment' },
  outbox: { title: 'Outbox', flush: 'Send now', retry: 'Retry', edit: 'Edit', discard: 'Discard', discardedToast: 'Duplicate change discarded.' },
  offline: { banner: 'You are offline. Changes are saved and will send when you reconnect.', },
  status: { QUARANTINED: 'Quarantined', OFFLINE: 'Offline', HOS_ALERT: 'Rest alert', SPEEDING: 'Speeding', MOVING: 'Moving', IDLING: 'Idling', PARKED: 'Parked', OPERATIONAL: 'Operational' },
  actions: { cancel: 'Cancel', save: 'Save', submit: 'Submit', OPEN_CLOCKOUT: 'Go to clock out', OPEN_SHIFT: 'Go to my shift', REFRESH: 'Refresh', VIEW_FLAGS: 'See flags', RETRY: 'Try again', EDIT: 'Fix and resend', DISCARD: 'Discard', CONTACT_ADMIN: 'Contact admin', RELOGIN: 'Log in again', WAIT: 'Wait, then try again', GIVE_CONSENT: 'Review consent', REGISTER_DEVICE: 'Register this device', MFA: 'Enter code', CONTINUE: 'Continue' },
  forms: { pickCard: 'Which card?', pooled: 'pooled', outOfRange: 'Must be between {{min}} and {{max}}.', odometerLower: 'That is lower than the last reading ({{last}} km). Check it.', odometerJump: 'That is {{km}} km more than the last reading. Check it.', lastReading: 'last {{km}} km',titleRefuel: 'Record a refuel', titleInspect: 'Daily inspection', retake: 'Retake', useTemplate: 'Use this checklist', noTemplateItems: 'This checklist has no items in the system yet. Ask your admin before submitting.', purchasedAt: 'When did you fuel (YYYY-MM-DDTHH:mmZ)', badNumber: 'Enter a number, e.g. 45.5', wholeNumber: 'Enter whole kilometres, e.g. 12345.', discardTitle: 'Discard changes?', discardBody: 'What you entered on this screen will be lost.', keepEditing: 'Keep editing', discard: 'Discard', flagged: 'Flagged for review: {{items}}', missing: 'Still needed: {{items}}', gaugeBeforePct: 'Fuel gauge before (%)', gaugeAfterPct: 'Fuel gauge after (%)', percentRange: 'Enter a number from 0 to 100.', optional: 'optional', submit: 'Submit', litres: 'Litres', cost: 'Total cost (KES)', cardLast4: 'Fuel card, last 4 digits', station: 'Station', gaugeBefore: 'Photo of gauge before fueling', gaugeAfter: 'Photo of gauge after fueling', receipt: 'Photo of receipt', template: 'Checklist', pass: 'Pass', fail: 'Fail', na: 'N/A', notes: 'Notes', defectsReviewed: 'I reviewed the previous defects', signature: 'Your full name (signature)', itemPhoto: 'Photo of the defect', noTemplates: 'No checklist is assigned to this vehicle.', queued: 'Saved. It will send when you are back online.', sent: 'Sent.' },
  accident: { severity: 'Severity', MINOR: 'Minor', MODERATE: 'Moderate', SEVERE: 'Severe', slot: { FRONT_DAMAGE: 'front', REAR_DAMAGE: 'rear', SIDE_DAMAGE: 'side', OTHER_VEHICLE_PLATE: 'other plate' }, mayday: 'Mayday: I need help now', maydayHelp: 'Sends your location straight away. No photos needed.', reason: 'What happened?', statement: 'Describe what happened', witness: 'Witness name', witnessPhone: 'Witness phone', plate: 'Other vehicle plate', report: 'Send accident report', sendMayday: 'Send Mayday', noGps: 'Turn on location to send your position.', addPhoto: 'Add damage photo' },
  admin: { accidents: 'Accidents', verify: 'Verify', flag: 'Flag', reject: 'Reject', clearPayment: 'Clear payment', acknowledge: 'Acknowledge', telemetry: 'Check telemetry chain', telemetryOk: 'Telemetry chain is intact.', telemetryBad: 'Telemetry chain has gaps or edits.', emptyDvir: 'No inspections waiting.', emptyFuel: 'No purchases waiting.', emptyAccidents: 'No open accidents.', loadMore: 'Load more', mayday: 'Mayday', addMedia: 'Add photo' },
  hardware: { title: 'Pair tracker', scanQr: 'Scan the QR code on the tracker', scanning: 'Point the camera at the QR code', scanHint: 'QR scanning is unavailable in the emulator.', scanAgain: 'Scan again', enterManually: 'Enter IMEI manually', imei: 'Tracker IMEI (15 digits)', brand: 'Tracker brand', sim: 'SIM number (optional)', vehicle: 'Vehicle', pickVehicle: 'Select a vehicle first', pair: 'Pair tracker', paired: 'Tracker paired. Send the SMS command to the SIM, then power-cycle the device.', enableCamera: 'Enable camera' },
  notifications: { empty: 'No notifications yet.', markAllRead: 'Mark all read', unread: 'Unread' },
  anomalies: { title: 'Flags', empty: 'Nothing flagged.', all: 'All', FUEL: 'Fuel', HOS: 'Rest hours', ACCIDENT: 'Accident', MAINTENANCE: 'Maintenance', SECURITY: 'Security', INFO: 'Info', WARNING: 'Warning', ALERT: 'Alert', LOW: 'Low', MEDIUM: 'Medium', HIGH: 'High', CRITICAL: 'Critical' },
  vehicle: { title: 'Vehicles', none: 'Clock in to see your vehicle.', stale: 'Live updates paused. Refreshing every 15 seconds.', create: 'Add vehicle', edit: 'Edit', reportIssue: 'Report issue', issues: 'Issues', noIssues: 'No issues reported.', toggleOperational: 'Toggle status', plate: 'License plate', make: 'Make', model: 'Model', class: 'Class', nonOperationalReason: 'Non-operational reason' },
  profile: { title: 'Profile', language: 'Language', consent: 'GPS tracking consent', resetPin: 'Set offline PIN', pinSaved: 'Offline PIN saved.', biometric: 'Unlock with fingerprint or face', openOutbox: 'Open outbox', setupMfa: 'Set up two-step login', edit: 'Edit profile', licenceNumber: 'Licence number', licenceClass: 'Licence class', emergencyName: 'Emergency contact name', emergencyPhone: 'Emergency contact phone', save: 'Save changes', saved: 'Profile saved.', backgroundCheck: 'Background check', bgProvider: 'Provider name', bgConsent: 'I consent to this check', bgSubmit: 'Submit background check', bgSubmitted: 'Background check submitted.', training: 'Training progress', revokeDevice: 'Revoke this device', passwordSaved: 'Password changed.' },
  pin: { title: 'Enter your PIN', attempts: '{{n}} tries left before a 15-minute lock', locked: 'Locked. Try again later.', wiped: 'PIN removed. Log in with your password.', loginInstead: 'Log in with password' },
  mfa: { title: 'Two-step login', body: 'Helix will send a 6-digit code each time you sign in, by SMS for drivers and by email for staff. Save the recovery codes below.', password: 'Confirm your password', start: 'Turn on two-step login', recoveryHelp: 'Save these now. They are shown once. Each works one time.', deliveredCodeHelp: 'Two-step login is on. Keep these codes somewhere safe.', },
  drivers: { title: 'Drivers', empty: 'No drivers found.', active: 'Active', suspended: 'Suspended', mfa: 'Two-step on', noMfa: 'Two-step off', lastLogin: 'Last login', revokeDevice: 'Revoke device', revokeSessions: 'Sign out everywhere', suspend: 'Suspend', reinstate: 'Reinstate', devices: 'Devices', confirm: 'Confirm', create: 'Create driver', email: 'Email', created: 'Driver created.', pending: 'Pending approval', approve: 'Approve', approved: 'Driver approved.' },
  docs: { title: 'Expiring documents', empty: 'Nothing expires soon.', days: '{{n}} days left', expired: 'Expired', renewalNote: 'Renewal note', note: 'Note', saveNote: 'Save note', noteSaved: 'Renewal note saved.' },
  security: { hooked: 'Debugging or instrumentation tools were detected, so Helix cannot start.', pinningMissing: 'Secure connection is not configured for this build.', blockedTitle: 'This device cannot be used', blockedBody: 'Fleet blocks rooted or jailbroken devices to protect driver and vehicle data.', registered: 'This device is registered.', rooted: 'This device is rooted or jailbroken.' },
  swap: { pickExisting: 'Hook an existing trailer', noTrailers: 'No trailer is available to hook right now.', newTrailer: 'Or add a new one', addNew: 'New trailer', type_DRY_VAN: 'Dry van', type_REEFER: 'Reefer', type_FLATBED: 'Flatbed', type_LOWBOY: 'Lowboy', type_TANKER: 'Tanker', type_CURTAIN_SIDE: 'Curtain side', type_OTHER: 'Other', title: 'Trailer swap', bobtail: 'Drop trailer (bobtail)', plate: 'New trailer plate', type: 'Trailer type', hookPhoto: 'Photo of the hook connection', inspection: 'Hook inspection ID (UUID)' },
  detail: { blockerItem: 'Critical: a failure grounds this vehicle.', tierShort: 'Tier {{n}}', evidence: 'Evidence', expires: 'Expires', tier: 'Escalation tier', timers: 'Escalation timers', acked: 'Acknowledged', notAcked: 'Not acknowledged yet', photo: 'Photo', noPhoto: 'No photo', gaugeBefore: 'Gauge before', gaugeAfter: 'Gauge after', gaugeDelta: 'Change', adjustLitres: 'Adjust litres (optional)', rejectReason: 'Reason for rejecting', openRelated: 'Open related', failed: 'Failed', passed: 'Passed', na: 'Not applicable', quarantine: 'Quarantine reason', hos: 'Rest hours', position: 'Last position', due: 'Due in', overdue: 'Overdue', noData: 'No details available.', document: 'Document number', issuerName: 'Issuer', },
  importer: { title: 'Import fuel statement', provider: 'Provider (e.g. bank)', periodStart: 'Period start (YYYY-MM-DD)', periodEnd: 'Period end (YYYY-MM-DD)', pick: 'Choose CSV file', picked: 'File: {{name}}', mapping: 'Column names in your CSV', date: 'Date column', amount: 'Amount column', card: 'Card column', litres: 'Litres column', station: 'Station column', submit: 'Import', done: 'Statement imported.', badDate: 'Use YYYY-MM-DD.' },
  profileExtra: { deviceId: 'Device ID', name: 'Signed in as', consentVersion: 'Version {{v}} accepted {{date}}', consentUnknown: 'No consent recorded on this device', model: 'Device', app: 'App version', },
  shifts: { title: 'Shifts to verify', empty: 'No shifts match these filters.', date: 'Date', status: 'Status', state: 'Shift state', PENDING: 'Pending', VERIFIED: 'Verified', FLAGGED: 'Flagged', OPEN: 'Open', PENDING_CLOSEOUT: 'Close-out pending', CLOSED: 'Closed', distance: 'Distance', duration: 'Duration', clockIn: 'Clocked in', clockOut: 'Clocked out', km: '{{n}} km', hours: '{{h}} h {{m}} min', flagReason: 'Why are you flagging this shift?', today: 'Today', anyDate: 'Any date', workPlan: 'Work plan', noPlan: 'No plan notes recorded.', forceClose: 'Force close shift', forceCloseReason: 'Reason for forcing close (optional)' },
  state: { dismiss: 'Dismiss', loading: 'Loading', offlineCopy: 'Offline copy', pending: 'Pending', waitSeconds: 'Wait {{n}}s' },
  alerts: { mayday: 'MAYDAY: a driver needs help', maydayOpen: 'Open', accidentUpdate: 'Help update: {{status}}', dismiss: 'Dismiss' },
  mayday: { hold: 'Hold to send Mayday', holding: 'Keep holding…', sent: 'Mayday sent. Help is being alerted.', queued: 'Mayday saved. It will send the moment you have signal.', hint: 'Sends your location. Hold for 2 seconds so it cannot be sent by accident.', failed: 'Mayday could not be sent. Try again or call for help.', noGps: 'Turn on location so help can find you.' },
  inbox: { title: 'Inbox', notifications: 'Notifications', flags: 'Flags', docs: 'Documents' },
  settings: { on: 'On', off: 'Off', account: 'Account', security: 'Security', device: 'This device', data: 'Data', switchRole: 'Switch to {{role}}', roleDRIVER: 'driver', roleADMIN: 'admin', logoutWarn: 'You have unsent changes. Logging out keeps them for the next time you sign in on this device. Tap again to log out.', readOnly: 'You can view this but not change it.', changePassword: 'Change password', newPassword: 'New password', profile: 'Profile & onboarding' },
   tabs: { overview: 'Overview', review: 'Review' },
  review: { shifts: 'Shifts', inspections: 'Inspections', fuel: 'Fuel' },
  dash: { attention: 'Needs attention', fleet: 'Fleet right now' },
  dashDetail: { title: 'Analytics', distanceKm: 'Distance (km)', fuelCost: 'Fuel cost', anomalies: 'Flags', vehicles: 'Vehicles', drivers: 'Drivers' },
  issue: { category: 'Category', severity: 'Severity', description: 'Description', descriptionPlaceholder: 'What is wrong?', status: 'Status', categoryMechanical: 'Mechanical', categoryElectrical: 'Electrical', categoryTyre: 'Tyre', categoryBody: 'Body', categoryOther: 'Other', severityLow: 'Low', severityMedium: 'Medium', severityHigh: 'High' },
  training: { title: 'Training', roster: 'Roster', viewDetail: 'View', mandatory: 'Mandatory', duration: 'Duration', minutes: 'minutes', complete: 'Complete', status: 'Status', statusCompleted: 'Completed', statusInProgress: 'In progress', statusNotStarted: 'Not started', completedAt: 'Completed at' },
  maintenance: { title: 'Maintenance', record: 'Record work order', viewDetail: 'View', taskId: 'Task ID', vehicleId: 'Vehicle ID', vendor: 'Vendor', cost: 'Cost', notes: 'Notes' },
  privacy: { title: 'Privacy', requestExport: 'Request data export', exportHelp: 'We will prepare a file with your data and notify you when it is ready.', notes: 'Notes (optional)', notesPlaceholder: 'Reason for export', submit: 'Submit', myRequests: 'My requests', noRequests: 'No requests yet.', tenantRequests: 'All requests', createdAt: 'Created' },
  gauge: { label: 'Fuel gauge reading', EMPTY: 'Empty', QUARTER: 'One quarter', HALF: 'Half', THREE_QUARTER: 'Three quarters', FULL: 'Full' },
  consent: { body: 'While you are clocked in, Helix records your working hours so the company can keep a correct log of your driving time and where the vehicle was.' },
  errors: {
    // ── session / identity ──
    UNAUTHENTICATED: 'Wrong email or password.',
    SESSION_REVOKED: 'Your sign-in has ended. Please log in again.',
    SESSION_LIMIT: 'Too many devices are signed in. Ask an admin to sign out the old ones.',
    ACCOUNT_SUSPENDED: 'Account suspended. Contact your admin.',
    DEVICE_REVOKED: 'This device is no longer allowed. Contact your admin.',
    IP_BLOCKED: 'Access from this network is temporarily blocked. Wait a moment and try again.',
    MFA_REQUIRED: 'Enter the 6-digit code we sent you.',
    CONSENT_REQUIRED: 'Accept GPS tracking consent to continue.',
    OFFLINE_PIN_LOCKED: 'Too many wrong PINs. Try again in 15 minutes.',
    OFFLINE_AUTH_EXPIRED: 'You have been offline too long. Log in to continue.',

    // ── authorisation / request shape ──
    FORBIDDEN: 'You do not have permission for this.',
    NOT_FOUND: 'That is no longer there.',
    VALIDATION_ERROR: 'Check the highlighted fields.',
    DUPLICATE: 'That has already been recorded.',
    RATE_LIMITED: 'Too many attempts. Try again shortly.',
    SERVICE_UNAVAILABLE: 'The server is busy. Try again.',

    // ── idempotency ──
    IDEMPOTENCY_CONFLICT: 'This change was already sent with different details.',
    IDEMPOTENCY_INFLIGHT: 'This change is still being saved. Retrying shortly.',

    // ── shift domain ──
    CLOCKOUT_PENDING: 'Your last shift still needs close-out. Finish it first.',
    SHIFT_ALREADY_OPEN: 'A shift is already open. Close it first.',
    UNLOCK_REQUIRED: 'This record is locked. Ask an admin to unlock it.',
    NO_ASSIGNMENT: 'You have no vehicle assigned. Contact your admin.',
    HOS_REST_BLOCKED: 'You are in a required rest period.',
    ODOMETER_DECREASED: 'Odometer cannot be lower than the last reading. Check it.',
    ODOMETER_DIVERGENCE: 'The odometer does not match the tracker. An admin will review it.',
    WORK_PLAN_REQUIRED: 'A work plan is needed before clocking out.',

    // ── inspection / fuel / media ──
    DVIR_FAIL_NEEDS_PHOTO: 'Add a photo for every failed item.',
    DEFECTS_NOT_REVIEWED: 'Confirm you reviewed the previous defects.',
    MEDIA_QUARANTINED: 'This file cannot be opened. Ask an admin.',

    // ── onboarding ──
    ONBOARDING_PROFILE_EMPTY: 'Fill in your name and national ID first.',
    ONBOARDING_CONSENT_REQUIRED: 'Accept the processing notice to continue.',
    BACKGROUND_CHECK_ALREADY_CLEARED: 'Your background check is already cleared.',

    // ── local only ──
    DEPENDENCY_FAILED: 'A step this depends on did not complete. Discard and enter it again.',
    UPLOAD_UNAVAILABLE: 'Photo upload is not ready. Try again.',
    UNKNOWN: 'Something went wrong. Try again.',
  },
  /** Signal vocabulary: shown next to a save that SUCCEEDED, never as a failure. */
  signals: {
    fuelAnomalyCritical: 'Fuel reading is out of range. An admin will check it.',
    gaugeDeltaHigh: 'The fuel gauge change looks too high.',
    fuelPriceSpike: 'The fuel price is higher than expected.',
    blockerDefect: 'Critical defect. This vehicle is quarantined.',
    offShiftMovement: 'This vehicle moved without an active shift.',
    trackerOffline: 'The tracker has stopped reporting.',
    unknown: 'A flag was raised on this record.',
  },
};
export type Dict = typeof en;
