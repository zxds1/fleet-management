import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../core/session.dart';
import '../design/tokens.dart';
import '../screens/admin/accident_detail_screen.dart';
import '../screens/admin/accidents_screen.dart';
import '../screens/admin/admin_fuel_screen.dart';
import '../screens/admin/driver_detail_screen.dart';
import '../screens/admin/drivers_screen.dart';
import '../screens/admin/dvir_detail_screen.dart';
import '../screens/admin/fuel_detail_screen.dart';
import '../screens/admin/import_statement_screen.dart';
import '../screens/admin/live_map_screen.dart';
import '../screens/admin/maintenance_screen.dart';
import '../screens/admin/overview_screen.dart';
import '../screens/admin/privacy_screen.dart';
import '../screens/admin/review_queue_screen.dart';
import '../screens/admin/settings_hub_screen.dart';
import '../screens/admin/shift_detail_screen.dart';
import '../screens/admin/tracker_pair_screen.dart';
import '../screens/admin/training_roster_screen.dart';
import '../screens/admin/training_screen.dart';
import '../screens/admin/vehicle_issues_screen.dart';
import '../screens/admin/vehicles_screen.dart';
import '../screens/auth/blocked_screen.dart';
import '../screens/auth/consent_screen.dart';
import '../screens/auth/login_screen.dart';
import '../screens/auth/mfa_screen.dart';
import '../screens/auth/password_reset_screen.dart';
import '../screens/auth/pin_screen.dart';
import '../screens/auth/role_switch_screen.dart';
import '../screens/auth/signup_screen.dart';
import '../screens/auth/splash_screen.dart';
import '../screens/auth/suspended_screen.dart';
import '../screens/driver/accident_screen.dart';
import '../screens/driver/clock_in_screen.dart';
import '../screens/driver/clock_out_screen.dart';
import '../screens/driver/dvir_history_screen.dart';
import '../screens/driver/edit_queued_screen.dart';
import '../screens/driver/home_screen.dart';
import '../screens/driver/inspect_screen.dart';
import '../screens/driver/my_vehicle_screen.dart';
import '../screens/driver/outbox_screen.dart';
import '../screens/driver/refuel_screen.dart';
import '../screens/driver/safety_screen.dart';
import '../screens/driver/settings_screen.dart';
import '../screens/driver/trailer_swap_screen.dart';
import '../screens/driver/work_screen.dart';
import '../screens/shared/anomaly_detail_screen.dart';
import '../screens/shared/doc_detail_screen.dart';
import '../screens/shared/inbox_screen.dart';
import '../screens/shared/mfa_setup_screen.dart';
import 'shells.dart';

const _driverTabs = <ShellTab>[
  ShellTab(
    route: '/driver/home',
    icon: Icons.home_rounded,
    activeIcon: Icons.home_rounded,
    labelKey: 'nav.home',
  ),
  ShellTab(
    route: '/driver/work',
    icon: Icons.fact_check_rounded,
    activeIcon: Icons.fact_check_rounded,
    labelKey: 'nav.work',
  ),
  ShellTab(
    route: '/driver/safety',
    icon: Icons.health_and_safety_rounded,
    activeIcon: Icons.health_and_safety_rounded,
    labelKey: 'nav.safety',
  ),
  ShellTab(
    route: '/driver/settings',
    icon: Icons.more_horiz_rounded,
    activeIcon: Icons.more_horiz_rounded,
    labelKey: 'nav.more',
  ),
];

const _adminTabs = <ShellTab>[
  ShellTab(
    route: '/admin/overview',
    icon: Icons.dashboard_rounded,
    activeIcon: Icons.dashboard_rounded,
    labelKey: 'tabs.overview',
  ),
  ShellTab(
    route: '/admin/map',
    icon: Icons.map_rounded,
    activeIcon: Icons.map_rounded,
    labelKey: 'nav.map',
  ),
  ShellTab(
    route: '/admin/accidents',
    icon: Icons.warning_amber_rounded,
    activeIcon: Icons.warning_amber_rounded,
    labelKey: 'nav.accidents',
  ),
  ShellTab(
    route: '/admin/review',
    icon: Icons.rule_rounded,
    activeIcon: Icons.rule_rounded,
    labelKey: 'tabs.review',
  ),
  ShellTab(
    route: '/admin/settings',
    icon: Icons.more_horiz_rounded,
    activeIcon: Icons.more_horiz_rounded,
    labelKey: 'nav.more',
  ),
];

/// The app's route table.
///
/// Two shells, each a [StatefulShellRoute.indexedStack] so a tab keeps its
/// scroll position, filters and form state when the user moves between tabs.
/// Every screen that is a *destination* of a task (clock-in, a detail view, a
/// sheet) lives on the root navigator above the shell, so it takes the whole
/// screen and the back gesture returns to the list the user came from.
GoRouter buildRouter(SessionService session) {
  return GoRouter(
    initialLocation: '/splash',
    refreshListenable: session,
    debugLogDiagnostics: false,
    redirect: (context, state) => helixRedirect(session, state.matchedLocation),
    routes: [
      // ── auth ───────────────────────────────────────────────────────────
      GoRoute(path: '/splash', builder: (_, _) => const SplashScreen()),
      GoRoute(path: '/login', builder: (_, _) => const LoginScreen()),
      GoRoute(path: '/signup', builder: (_, _) => const SignupScreen()),
      GoRoute(path: '/password-reset', builder: (_, _) => const PasswordResetScreen()),
      GoRoute(path: '/mfa', builder: (_, _) => const MfaScreen()),
      GoRoute(path: '/pin', builder: (_, _) => const PinScreen()),
      GoRoute(path: '/consent', builder: (_, _) => const ConsentScreen()),
      GoRoute(path: '/role-switch', builder: (_, _) => const RoleSwitchScreen()),
      GoRoute(path: '/blocked', builder: (_, _) => const BlockedScreen()),
      GoRoute(path: '/suspended', builder: (_, _) => const SuspendedScreen()),

      // ── driver shell ────────────────────────────────────────────────────
      StatefulShellRoute.indexedStack(
        builder: (context, state, navigationShell) => ShellScaffold(
          shell: Shell.driver,
          tabs: _driverTabs,
          navigationShell: navigationShell,
        ),
        branches: [
          StatefulShellBranch(routes: [
            GoRoute(path: '/driver/home', builder: (_, _) => const DriverHomeScreen()),
          ]),
          StatefulShellBranch(routes: [
            GoRoute(path: '/driver/work', builder: (_, _) => const WorkScreen()),
          ]),
          StatefulShellBranch(routes: [
            GoRoute(path: '/driver/safety', builder: (_, _) => const SafetyScreen()),
          ]),
          StatefulShellBranch(routes: [
            GoRoute(path: '/driver/settings', builder: (_, _) => const DriverSettingsScreen()),
          ]),
        ],
      ),

      // ── admin shell ─────────────────────────────────────────────────────
      StatefulShellRoute.indexedStack(
        builder: (context, state, navigationShell) => ShellScaffold(
          shell: Shell.admin,
          tabs: _adminTabs,
          navigationShell: navigationShell,
        ),
        branches: [
          StatefulShellBranch(routes: [
            GoRoute(path: '/admin/overview', builder: (_, _) => const AdminOverviewScreen()),
          ]),
          StatefulShellBranch(routes: [
            GoRoute(path: '/admin/map', builder: (_, _) => const LiveMapScreen()),
          ]),
          StatefulShellBranch(routes: [
            GoRoute(path: '/admin/accidents', builder: (_, _) => const AdminAccidentsScreen()),
          ]),
          StatefulShellBranch(routes: [
            GoRoute(path: '/admin/review', builder: (_, _) => const ReviewQueueScreen()),
          ]),
          StatefulShellBranch(routes: [
            GoRoute(path: '/admin/settings', builder: (_, _) => const AdminSettingsHubScreen()),
          ]),
        ],
      ),

      // ── driver destinations ─────────────────────────────────────────────
      GoRoute(path: '/driver/clock-in', builder: (_, _) => const ClockInScreen()),
      GoRoute(path: '/driver/clock-out', builder: (_, _) => const ClockOutScreen()),
      GoRoute(path: '/driver/refuel', builder: (_, _) => const RefuelScreen()),
      GoRoute(path: '/driver/inspect', builder: (_, _) => const InspectScreen()),
      GoRoute(path: '/driver/accidents', builder: (_, _) => const AccidentScreen()),
      GoRoute(path: '/driver/trailer-swap', builder: (_, _) => const TrailerSwapScreen()),
      GoRoute(path: '/driver/my-vehicle', builder: (_, _) => const MyVehicleScreen()),
      GoRoute(path: '/driver/outbox', builder: (_, _) => const OutboxScreen()),
      GoRoute(
        path: '/driver/outbox/:id/edit',
        builder: (context, state) {
          final raw = state.pathParameters['id'];
          final id = int.tryParse(raw ?? '');
          if (id == null) {
            return const Scaffold(body: Center(child: Text('Unknown queue item')));
          }
          return EditQueuedScreen(id: id);
        },
      ),
      GoRoute(path: '/driver/dvir-history', builder: (_, _) => const DvirHistoryScreen()),
      GoRoute(path: '/driver/inbox', builder: (_, _) => const InboxScreen()),
      GoRoute(path: '/driver/mfa-setup', builder: (_, _) => const MfaSetupScreen()),

      // ── admin destinations ──────────────────────────────────────────────
      GoRoute(
        path: '/admin/accidents/:id',
        builder: (context, state) => AccidentDetailScreen(accidentId: state.pathParameters['id']!),
      ),
      GoRoute(
        path: '/admin/shifts/:id',
        builder: (context, state) => ShiftDetailScreen(shiftId: state.pathParameters['id']!),
      ),
      GoRoute(
        path: '/admin/inspections/:id',
        builder: (context, state) => DvirDetailScreen(inspectionId: state.pathParameters['id']!),
      ),
      GoRoute(
        path: '/admin/fuel/:id',
        builder: (context, state) => FuelDetailScreen(purchaseId: state.pathParameters['id']!),
      ),
      GoRoute(path: '/admin/fuel-pending', builder: (_, _) => const AdminFuelScreen()),
      GoRoute(path: '/admin/import-statement', builder: (_, _) => const ImportStatementScreen()),
      GoRoute(path: '/admin/drivers', builder: (_, _) => const DriversScreen()),
      GoRoute(
        path: '/admin/drivers/:id',
        builder: (context, state) => DriverDetailScreen(userId: state.pathParameters['id']!),
      ),
      GoRoute(path: '/admin/vehicles', builder: (_, _) => const VehiclesScreen()),
      GoRoute(
        path: '/admin/vehicle-issues/:id',
        builder: (context, state) => VehicleIssuesScreen(vehicleId: state.pathParameters['id']!),
      ),
      GoRoute(path: '/admin/training', builder: (_, _) => const TrainingScreen()),
      GoRoute(path: '/admin/training/roster', builder: (_, _) => const TrainingRosterScreen()),
      GoRoute(path: '/admin/maintenance', builder: (_, _) => const MaintenanceScreen()),
      GoRoute(path: '/admin/privacy', builder: (_, _) => const PrivacyScreen()),
      GoRoute(path: '/admin/tracker-pair', builder: (_, _) => const TrackerPairScreen()),
      GoRoute(path: '/admin/inbox', builder: (_, _) => const InboxScreen()),

      // ── shared ──────────────────────────────────────────────────────────
      GoRoute(
        path: '/anomaly/:id',
        builder: (context, state) => AnomalyDetailScreen(anomalyId: state.pathParameters['id']!),
      ),
      GoRoute(
        path: '/document/:id',
        builder: (context, state) => DocDetailScreen(documentId: state.pathParameters['id']!),
      ),
    ],
    errorBuilder: (context, state) => Scaffold(
      body: Center(child: Text('Route not found: ${state.uri.path}')),
    ),
  );
}

/// Routes that only make sense before the session is established.
const _authArea = <String>{
  '/splash',
  '/login',
  '/signup',
  '/password-reset',
  '/mfa',
  '/pin',
  '/consent',
  '/role-switch',
  '/blocked',
  '/suspended',
};

bool _inArea(String location, Set<String> area) {
  if (area.contains(location)) return true;
  for (final path in area) {
    if (location.startsWith('$path/')) return true;
  }
  return false;
}

/// Where a signed-in session lands when it has to pick a shell.
String _homeFor(SessionService session) {
  final driver = session.roles.contains('DRIVER');
  final admin = session.roles.any(adminRoles.contains);
  if (driver && admin) {
    final persisted = session.persistedShell;
    if (persisted == 'admin') return '/admin/overview';
    if (persisted == 'driver') return '/driver/home';
    return '/role-switch';
  }
  if (admin) return '/admin/overview';
  if (driver) return '/driver/home';
  return '/login';
}

/// The redirect rule, as a pure function of (session, location).
///
/// Split out from the [GoRouter] so it can be exercised directly: the guard
/// that keeps a driver out of the admin shell is a security control, not
/// wiring.
String? helixRedirect(SessionService session, String location) {
  switch (session.status) {
    case AuthStatus.booting:
      return _inArea(location, {'/splash'}) ? null : '/splash';
    case AuthStatus.blocked:
      return _inArea(location, {'/blocked'}) ? null : '/blocked';
    case AuthStatus.suspended:
      return _inArea(location, {'/suspended'}) ? null : '/suspended';
    case AuthStatus.needsPin:
      return _inArea(location, {'/pin'}) ? null : '/pin';
    case AuthStatus.needsMfa:
      return _inArea(location, {'/mfa'}) ? null : '/mfa';
    case AuthStatus.needsConsent:
      return _inArea(location, {'/consent'}) ? null : '/consent';
    case AuthStatus.signedOut:
      return _inArea(location, _authArea) ? null : '/login';
    case AuthStatus.signedIn:
      break;
  }

  if (_inArea(location, _authArea)) {
    return _homeFor(session);
  }

  final wantsAdmin = location.startsWith('/admin');
  final wantsDriver = location.startsWith('/driver');
  if (wantsAdmin && !session.roles.any(adminRoles.contains)) {
    return session.roles.contains('DRIVER') ? '/driver/home' : '/login';
  }
  if (wantsDriver && !session.roles.contains('DRIVER')) {
    return session.roles.any(adminRoles.contains) ? '/admin/overview' : '/login';
  }
  return null;
}
