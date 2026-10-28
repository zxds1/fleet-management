import 'package:socket_io_client/socket_io_client.dart' as io;
import 'policy.dart';
import 'config.dart';

/// Realtime client. The app LISTENS — the gateway derives rooms from the
/// Principal, so there is no subscribe event. Events invalidate query keys;
/// payloads are never written into caches.
class RealtimeService {
  RealtimeService({required this.tokenProvider, required this.onEvent});

  final Future<String?> Function() tokenProvider;
  final void Function(String, dynamic) onEvent;
  io.Socket? _socket;
  final Map<String, DateTime> _lastInvalidate = {};
  bool _connected = false;

  bool get connected => _connected;

  static const events = [
    'map:vehicle-states',
    'notifications',
    'accident:live',
    'driver:shift',
    'driver:vehicle',
    'driver:accident',
  ];

  Future<void> connect() async {
    _socket?.dispose();
    final token = await tokenProvider();
    final socket = io.io(
      Config.wsUrl,
      io.OptionBuilder()
          .setTransports(['websocket'])
          .disableAutoConnect()
          .setAuth({'token': token ?? ''})
          .build(),
    );
    socket.onConnect((_) {
      _connected = true;
      for (final event in events) {
        onEvent(event, const {'snapshot': true});
      }
    });
    socket.onDisconnect((_) => _connected = false);
    socket.onConnectError((_) => _connected = false);
    for (final event in events) {
      socket.on(event, (payload) {
        final now = DateTime.now();
        final last = _lastInvalidate[event];
        if (last != null && now.difference(last) < Policy.realtimeThrottle) {
          return;
        }
        _lastInvalidate[event] = now;
        onEvent(event, payload);
      });
    }
    socket.connect();
    _socket = socket;
  }

  void dispose() {
    _socket?.dispose();
    _socket = null;
    _connected = false;
  }
}
