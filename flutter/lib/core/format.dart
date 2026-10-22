import 'dart:convert';
import 'package:crypto/crypto.dart';
import 'package:intl/intl.dart';

/// Formatting helpers — money as a two-place KES string (never a float),
/// decimal commas accepted on input, EAT operational dates.
class Fmt {
  Fmt._();

  static const Duration eatOffset = Duration(hours: 3); // Africa/Nairobi (no DST)

  static final _money = NumberFormat('#,##0.00', 'en_KE');
  static final _whole = NumberFormat('#,##0', 'en_KE');
  static final DateFormat _date = DateFormat('dd MMM yyyy');
  static final DateFormat _time = DateFormat('HH:mm');
  static final DateFormat _dateTime = DateFormat('dd MMM yyyy HH:mm');
  static final DateFormat _isoDate = DateFormat('yyyy-MM-dd');
  static final DateFormat _isoDateTime = DateFormat("yyyy-MM-dd'T'HH:mm:ss");

  static String money(num? value) => value == null ? '—' : 'KES ${_money.format(value)}';
  static String moneyParts(num? value) => value == null ? '—' : _money.format(value);
  static String whole(num? value) => value == null ? '—' : _whole.format(value);
  static String date(DateTime? d) => d == null ? '—' : _date.format(d.toUtc().add(const Duration(hours: 3)));
  static String time(DateTime? d) => d == null ? '—' : _time.format(d.toUtc().add(const Duration(hours: 3)));
  static String dateTime(DateTime? d) => d == null ? '—' : _dateTime.format(d.toUtc().add(const Duration(hours: 3)));
  static String isoDate(DateTime d) => _isoDate.format(d.toUtc().add(eatOffset));
  static String isoDateTime(DateTime d) =>
      '${_isoDateTime.format(d.toUtc().add(eatOffset))}+03:00';
  static String percent(double v) => '${(v * 100).round()}%';
  static String km(num? v) => v == null ? '—' : '${_whole.format(v)} km';
  static String celsius(num? v) => v == null ? '—' : '${_money.format(v)} °C';

  /// Accepts "45,5", "45.5" and "1,000"; returns null when not a number.
  ///
  /// A comma is a thousands separator when the string also carries a decimal
  /// point, or when it is the only separator and exactly three digits follow
  /// it ("1,000" is one thousand, "45,5" is forty-five and a half).
  static double? parseDecimal(String input) {
    final cleaned = input.trim().replaceAll(' ', '');
    if (cleaned.isEmpty) return null;
    final hasComma = cleaned.contains(',');
    final hasDot = cleaned.contains('.');
    final String normalized;
    if (hasComma && hasDot) {
      normalized = cleaned.replaceAll(',', '');
    } else if (hasComma && _isThousandsGroup(cleaned)) {
      normalized = cleaned.replaceAll(',', '');
    } else {
      normalized = cleaned.replaceAll(',', '.');
    }
    return double.tryParse(normalized);
  }

  static bool _isThousandsGroup(String value) {
    final parts = value.split(',');
    if (parts.length < 2) return false;
    if (!RegExp(r'^\d{3}$').hasMatch(parts.last)) return false;
    return parts
        .sublist(0, parts.length - 1)
        .every((p) => RegExp(r'^\d{1,3}$').hasMatch(p));
  }

  /// Parses a server timestamp. A naive string (no offset) is UTC — reading it
  /// as local time would shift every server clock by the device offset.
  static DateTime? parseTimestamp(String? raw) {
    if (raw == null) return null;
    final text = raw.trim();
    if (text.isEmpty) return null;
    final parsed = DateTime.tryParse(text);
    if (parsed == null) return null;
    if (parsed.isUtc) return parsed;
    return DateTime.utc(
      parsed.year,
      parsed.month,
      parsed.day,
      parsed.hour,
      parsed.minute,
      parsed.second,
      parsed.millisecond,
      parsed.microsecond,
    );
  }

  static int? parseWhole(String input) {
    final normalized = input.trim().replaceAll(RegExp(r'[^0-9]'), '');
    return normalized.isEmpty ? null : int.tryParse(normalized);
  }

  static String? moneyValueToString(num v) => _money.format(v);

  // Countdown mm:ss (also used for HOS rest and escalation).
  static String countdown(Duration d) {
    final negative = d.isNegative;
    final abs = d.abs();
    final mm = abs.inMinutes.toString().padLeft(2, '0');
    final ss = (abs.inSeconds % 60).toString().padLeft(2, '0');
    return '${negative ? '-' : ''}$mm:$ss';
  }
}

String sha256Hex(String input) => sha256.convert(utf8.encode(input)).toString();
