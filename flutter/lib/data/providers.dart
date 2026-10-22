import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../app/container.dart';
import '../core/format.dart';
import '../core/policy.dart';
import 'repository.dart';

/// Shared query providers. One home per domain so realtime events, queue
/// completions and error actions can invalidate exactly the right keys.
final repositoryProvider = Provider<Repository>((ref) {
  return Repository(ref.watch(containerProvider).api);
});

final onboardingProvider = FutureProvider<Map<String, dynamic>?>((ref) async {
  try {
    return await ref.watch(repositoryProvider).myOnboarding();
  } catch (_) {
    return null;
  }
});

final activeShiftProvider = FutureProvider<Map<String, dynamic>?>((ref) {
  return ref.watch(repositoryProvider).activeShift();
});

final assignmentProvider = FutureProvider<Map<String, dynamic>?>((ref) {
  return ref.watch(repositoryProvider).myAssignment();
});

final vehicleStatesProvider = FutureProvider<List<Map<String, dynamic>>>((ref) async {
  return ref.watch(repositoryProvider).vehicleStates();
});

/// The vehicle this driver is bound to: the assignment first, the open shift
/// as the fallback.
final ownVehicleIdProvider = FutureProvider<String?>((ref) async {
  final assignment = await ref.watch(assignmentProvider.future);
  final assigned = assignment?['vehicle_id'] as String?;
  if (assigned != null && assigned.isNotEmpty) return assigned;
  final shift = await ref.watch(activeShiftProvider.future);
  final shifted = shift?['vehicle_id'] as String?;
  if (shifted != null && shifted.isNotEmpty) return shifted;
  return null;
});

/// The driver's OWN vehicle. The fleet map answers every vehicle for a
/// privileged caller, so the row is joined with the driver's own assignment
/// instead of taking the first one.
final myVehicleProvider = FutureProvider<Map<String, dynamic>?>((ref) async {
  final vehicleId = await ref.watch(ownVehicleIdProvider.future);
  if (vehicleId == null) return null;
  final states = await ref.watch(repositoryProvider).vehicleStates();
  for (final state in states) {
    if (state['vehicle_id'] == vehicleId) return state;
  }
  return null;
});

final templatesProvider = FutureProvider<List<Map<String, dynamic>>>((ref) async {
  return ref.watch(repositoryProvider).templates();
});

final trailersProvider = FutureProvider<List<Map<String, dynamic>>>((ref) async {
  return ref.watch(repositoryProvider).trailers();
});

final fuelCardsProvider = FutureProvider<List<Map<String, dynamic>>>((ref) async {
  final shift = await ref.watch(activeShiftProvider.future);
  final body = await ref.watch(repositoryProvider).fuelCards(vehicleId: shift?['vehicle_id'] as String?);
  return (body['cards'] as List?)?.cast<Map<String, dynamic>>() ?? const [];
});

final analyticsProvider = FutureProvider<Map<String, dynamic>>((ref) async {
  return ref.watch(repositoryProvider).analytics();
});

final accidentsProvider = FutureProvider<List<Map<String, dynamic>>>((ref) async {
  final page = await ref.watch(repositoryProvider).accidents(ownScope: false);
  return page.data;
});

final notificationsProvider = FutureProvider<List<Map<String, dynamic>>>((ref) async {
  final page = await ref.watch(repositoryProvider).page('notifications');
  return page.data;
});

final notificationsUnreadProvider = FutureProvider<int>((ref) async {
  final body = await ref.watch(repositoryProvider).notificationCount();
  return (body['unread'] as int?) ?? 0;
});

final anomaliesProvider = FutureProvider<List<Map<String, dynamic>>>((ref) async {
  final page = await ref.watch(repositoryProvider).page('anomalies');
  return page.data;
});

final expiringDocsProvider = FutureProvider<List<Map<String, dynamic>>>((ref) async {
  final page = await ref.watch(repositoryProvider).page('documents/expiring', query: {'within_days': Policy.documentsWarnDays});
  return page.data;
});

final driversProvider = FutureProvider<List<Map<String, dynamic>>>((ref) async {
  final page = await ref.watch(repositoryProvider).page('drivers');
  return page.data;
});

final vehiclesProvider = FutureProvider<List<Map<String, dynamic>>>((ref) async {
  return ref.watch(repositoryProvider).rawList('vehicles', query: {'limit': 200});
});

/// The last odometer reading this driver may build on: the open shift's
/// start reading, else the driver's own vehicle odometer.
final lastOdometerProvider = FutureProvider<int?>((ref) async {
  final shift = await ref.watch(activeShiftProvider.future);
  final shiftKm = (shift?['start_odometer_km'] as num?)?.toInt();
  if (shiftKm != null) return shiftKm;
  final vehicle = await ref.watch(myVehicleProvider.future);
  return (vehicle?['odometer_km'] as num?)?.toInt();
});

/// When this driver may clock in next — from the driver's own vehicle, never
/// from the fleet average.
final hosRestProvider = FutureProvider<DateTime?>((ref) async {
  final vehicle = await ref.watch(myVehicleProvider.future);
  final next = Fmt.parseTimestamp(vehicle?['next_eligible_clock_in_at']?.toString());
  if (next == null) return null;
  return next.isAfter(DateTime.now().toUtc()) ? next : null;
});

final outboxCountProvider = FutureProvider<int>((ref) {
  return ref.watch(containerProvider).queue.openCount;
});
