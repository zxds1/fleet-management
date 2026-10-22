import 'dart:ui' show PlatformDispatcher;
import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../core/policy.dart';
import '../core/kv_store.dart';
import 'en.dart';
import 'sw.dart';

/// Locale controller. Selection order (B-19): remembered explicit choice
/// (secure store) → device locale (`sw` only when the device language IS
/// Swahili, otherwise English) → English. The account/server locale is not
/// consulted — the server localises notification copy only.
class LocaleController extends StateNotifier<Locale> {
  LocaleController(this._prefs, this._store) : super(const Locale('en'));

  final SharedPreferences? _prefs;
  final KeyValueStore _store;

  static const _key = 'helix.locale';

  /// Call once at boot after prefs+store are attached.
  Future<void> load() async {
    final remembered = _prefs?.getString(_key);
    if (remembered != null && Policy.locales.contains(remembered)) {
      state = Locale(remembered);
      return;
    }
    final device = PlatformDispatcher.instance.locale.languageCode;
    state = Locale(Policy.localeForDevice(device));
  }

  Future<void> setLocale(String code) async {
    if (!Policy.locales.contains(code)) return;
    state = Locale(code);
    await _prefs?.setString(_key, code);
    await _store.write(StoreKeys.locale, code);
  }

  Future<void> toggle() => setLocale(state.languageCode == 'en' ? 'sw' : 'en');
}

/// Dictionary lookup with {{interpolation}}.
class Strings {
  Strings._(this.locale);
  final Locale locale;

  static Strings of(BuildContext context) =>
      Strings._(Localizations.localeOf(context));

  Map<String, Map<String, String>> get _dict => locale.languageCode == 'sw' ? sw : en;

  String t(String key, [Map<String, String> params = const {}]) {
    final entry = _dict[key];
    assert(() {
      if (entry == null && !en.containsKey(key)) {
        debugPrint('Helix i18n: no entry for "$key" (${locale.languageCode})');
      }
      return true;
    }());
    var value = entry?['v'] ?? en[key]?['v'] ?? key;
    params.forEach((k, v) {
      value = value.replaceAll('{{$k}}', v);
    });
    return value;
  }

  /// Error catalogue message.
  String error(String code) => t('errors.$code');

  /// Action label from the catalogue entry.
  String actionLabel(String action) => t('actions.$action');
}

/// Localised strings from any build context. Lives here (not in the screen
/// layer) so design components can localise without importing a screen.
extension HelixStringsX on BuildContext {
  Strings get s => Strings.of(this);
}
