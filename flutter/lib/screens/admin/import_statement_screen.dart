import 'dart:convert';
import 'dart:typed_data';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../app/providers.dart';
import '../../core/errors.dart';
import '../../data/providers.dart';
import '../../design/components/buttons.dart';
import '../../design/components/card.dart';
import '../../design/components/field.dart';
import '../../design/components/screen.dart';
import '../../design/components/text.dart';
import '../../design/tokens.dart';
import '../common.dart';

/// Fuel statement import: upload the CSV as a document (never through the
/// image pipeline, which would refuse a non-image), map the statement's
/// columns onto the canonical names the reconciliation worker reads, preview
/// the first rows locally, then POST /reconciliation/statements.
class ImportStatementScreen extends ConsumerStatefulWidget {
  const ImportStatementScreen({super.key});

  @override
  ConsumerState<ImportStatementScreen> createState() => _ImportStatementScreenState();
}

/// The worker reads `columnMapping` as source header → canonical target and
/// then looks for `transactionAt`, `cardLastFour`, `amount` and `stationName`.
/// A canonical key that is not in that list is silently ignored, so the form
/// only offers the four the reconciler actually uses.
const _targetDate = 'transactionAt';
const _targetAmount = 'amount';
const _targetCard = 'cardLastFour';
const _targetStation = 'stationName';

class _ImportStatementScreenState extends ConsumerState<ImportStatementScreen> {
  final _provider = TextEditingController();
  final _start = TextEditingController();
  final _end = TextEditingController();
  final _date = TextEditingController();
  final _amount = TextEditingController();
  final _card = TextEditingController();
  final _station = TextEditingController();

  String? _mediaObjectId;
  String? _fileName;
  List<String> _headers = const [];
  List<List<String>> _rows = const [];
  int _matched = 0;
  int _unmatched = 0;
  bool _busy = false;
  bool _picking = false;
  String? _providerError;
  String? _startError;
  String? _endError;

  @override
  void dispose() {
    _provider.dispose();
    _start.dispose();
    _end.dispose();
    _date.dispose();
    _amount.dispose();
    _card.dispose();
    _station.dispose();
    super.dispose();
  }

  bool get _ready => _mediaObjectId != null && _providerError == null && _startError == null && _endError == null;

  Future<void> _pickFile() async {
    setState(() => _picking = true);
    try {
      final result = await FilePicker.pickFiles(
        type: FileType.custom,
        allowedExtensions: ['csv'],
        withData: true,
      );
      final picked = result?.files.firstOrNull;
      final bytes = picked?.bytes;
      if (picked == null || bytes == null || bytes.isEmpty) {
        if (mounted) setState(() => _picking = false);
        return;
      }
      final media = ref.read(mediaProvider);
      // A CSV never decodes as a picture, so the capture path would refuse it.
      final staged = await media.stageDocument(
        bytes,
        filename: picked.name,
        contentType: 'text/csv',
      );
      final mediaObjectId = await media.uploadStaged(staged);
      if (!mounted) return;
      setState(() {
        _mediaObjectId = mediaObjectId;
        _fileName = picked.name;
        _picking = false;
        _readPreview(bytes);
      });
    } on HelixError catch (e) {
      if (!mounted) return;
      setState(() => _picking = false);
      showHelixError(context, e);
    } catch (_) {
      if (!mounted) return;
      setState(() => _picking = false);
      showHelixError(
        context,
        HelixError(code: 'UPLOAD_UNAVAILABLE', status: 0),
      );
    }
  }

  /// Reads the header row and the first rows so the mapping can be guessed and
  /// previewed before anything is committed.
  void _readPreview(Uint8List bytes) {
    try {
      final text = utf8.decode(bytes, allowMalformed: true);
      final rows = _parseCsv(text);
      if (rows.isEmpty) {
        _headers = const [];
        _rows = const [];
        return;
      }
      _headers = rows.first.map((h) => h.trim()).toList();
      _rows = rows.skip(1).toList();
      _date.text = _guess(_headers, const ['transaction date', 'transaction', 'posted', 'date']) ?? '';
      _amount.text = _guess(_headers, const ['amount', 'total cost', 'value', 'total']) ?? '';
      _card.text = _guess(_headers, const ['last four', 'last4', 'card', 'pan']) ?? '';
      _station.text = _guess(_headers, const ['station', 'merchant', 'site', 'location']) ?? '';
      _recount();
    } catch (_) {
      _headers = const [];
      _rows = const [];
    }
  }

  /// Counts the rows the worker would keep (a parsable date and amount) and
  /// the rows it would drop.
  void _recount() {
    var matched = 0;
    var unmatched = 0;
    final dateSource = _date.text.trim();
    final amountSource = _amount.text.trim();
    for (final row in _rows.take(5)) {
      final values = <String, String>{};
      for (var i = 0; i < _headers.length; i++) {
        values[_headers[i]] = i < row.length ? row[i].trim() : '';
      }
      final rawDate = dateSource.isEmpty ? '' : (values[dateSource] ?? '');
      final rawAmount = amountSource.isEmpty ? '' : (values[amountSource] ?? '');
      final dateOk = rawDate.isNotEmpty && DateTime.tryParse(rawDate) != null;
      final amountOk = double.tryParse(rawAmount.replaceAll(',', '')) != null;
      if (dateOk && amountOk) {
        matched++;
      } else {
        unmatched++;
      }
    }
    setState(() {
      _matched = matched;
      _unmatched = unmatched;
    });
  }

  static String? _guess(List<String> headers, List<String> needles) {
    for (final needle in needles) {
      for (final header in headers) {
        if (header.toLowerCase().contains(needle)) return header;
      }
    }
    return null;
  }

  void _validate() {
    final strings = context.s;
    final provider = _provider.text.trim();
    final start = _start.text.trim();
    final end = _end.text.trim();
    setState(() {
      _providerError = provider.isEmpty ? strings.error('VALIDATION_ERROR') : null;
      _startError = _isIsoDate(start) ? null : strings.error('VALIDATION_ERROR');
      _endError = _isIsoDate(end) ? null : strings.error('VALIDATION_ERROR');
    });
  }

  static bool _isIsoDate(String value) =>
      RegExp(r'^\d{4}-\d{2}-\d{2}$').hasMatch(value) && DateTime.tryParse(value) != null;

  Future<void> _submit() async {
    final strings = context.s;
    _validate();
    if (!_ready) return;
    setState(() => _busy = true);
    try {
      final mapping = <String, String>{};
      if (_date.text.trim().isNotEmpty) mapping[_date.text.trim()] = _targetDate;
      if (_amount.text.trim().isNotEmpty) mapping[_amount.text.trim()] = _targetAmount;
      if (_card.text.trim().isNotEmpty) mapping[_card.text.trim()] = _targetCard;
      if (_station.text.trim().isNotEmpty) mapping[_station.text.trim()] = _targetStation;
      await ref.read(repositoryProvider).importStatement({
        'provider': _provider.text.trim(),
        'period_start': _start.text.trim(),
        'period_end': _end.text.trim(),
        'media_object_id': _mediaObjectId,
        'column_mapping': mapping,
      });
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(strings.t('importer.done'))));
      Navigator.of(context).pop();
    } on HelixError catch (e) {
      if (!mounted) return;
      showHelixError(context, e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final strings = context.s;
    return Scaffold(
      appBar: AppBar(
        title: HelixText(strings.t('importer.title'), style: TypeScale.title(AppColors.text)),
        backgroundColor: AppColors.frostChrome,
        iconTheme: IconThemeData(color: AppColors.text),
        foregroundColor: AppColors.text,
      ),
      body: Screen(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            HelixCard(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  HelixText(strings.t('importer.pick'), style: TypeScale.body(AppColors.text)),
                  const SizedBox(height: AppSpace.s2),
                  OutlinedButton.icon(
                    icon: Icon(Icons.attach_file_rounded, color: AppColors.adminAccent),
                    label: HelixText(
                      _mediaObjectId == null ? strings.t('importer.pick') : strings.t('importer.uploaded'),
                      style: TypeScale.body(AppColors.text),
                    ),
                    onPressed: _picking || _busy ? null : _pickFile,
                  ),
                  if (_fileName != null) ...[
                    const SizedBox(height: AppSpace.s2),
                    HelixText(_fileName!, style: TypeScale.caption(AppColors.textSecondary)),
                  ],
                ],
              ),
            ),
            const SizedBox(height: AppSpace.s4),
            Field(
              label: strings.t('importer.provider'),
              controller: _provider,
              required: true,
              errorText: _providerError,
              onChanged: (_) => setState(() => _providerError = null),
            ),
            const SizedBox(height: AppSpace.s4),
            Field(
              label: strings.t('importer.periodStart'),
              controller: _start,
              required: true,
              errorText: _startError,
              onChanged: (_) => setState(() => _startError = null),
            ),
            const SizedBox(height: AppSpace.s4),
            Field(
              label: strings.t('importer.periodEnd'),
              controller: _end,
              required: true,
              errorText: _endError,
              onChanged: (_) => setState(() => _endError = null),
            ),
            const SizedBox(height: AppSpace.s4),
            HelixText(strings.t('importer.mapping'), style: TypeScale.caption(AppColors.textSecondary)),
            const SizedBox(height: AppSpace.s2),
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: Field(
                    label: strings.t('importer.date'),
                    controller: _date,
                    onChanged: (_) => _recount(),
                  ),
                ),
                const SizedBox(width: AppSpace.s2),
                Expanded(
                  child: Field(
                    label: strings.t('importer.amount'),
                    controller: _amount,
                    onChanged: (_) => _recount(),
                  ),
                ),
              ],
            ),
            const SizedBox(height: AppSpace.s3),
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: Field(
                    label: strings.t('importer.card'),
                    controller: _card,
                    onChanged: (_) => _recount(),
                  ),
                ),
                const SizedBox(width: AppSpace.s2),
                Expanded(
                  child: Field(
                    label: strings.t('importer.station'),
                    controller: _station,
                    onChanged: (_) => _recount(),
                  ),
                ),
              ],
            ),
            if (_rows.isNotEmpty) ...[
              const SizedBox(height: AppSpace.s4),
              HelixCard(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    HelixText(strings.t('importer.preview'), style: TypeScale.bodyStrong(AppColors.text)),
                    const SizedBox(height: AppSpace.s2),
                    HelixText(
                      '${strings.t('importer.matched')}: $_matched · ${strings.t('importer.unmatched')}: $_unmatched',
                      style: TypeScale.caption(AppColors.textSecondary),
                    ),
                  ],
                ),
              ),
            ],
            const SizedBox(height: AppSpace.s5),
            StrandButton(
              label: strings.t('importer.submit'),
              shell: Shell.admin,
              busy: _busy,
              onPressed: _ready && !_busy ? _submit : null,
            ),
            if (!_ready) ...[
              const SizedBox(height: AppSpace.s2),
              HelixText(
                _mediaObjectId == null ? strings.t('importer.pick') : strings.error('VALIDATION_ERROR'),
                style: TypeScale.caption(AppColors.textSecondary),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

/// RFC-4180-ish CSV reader: fields may be quoted, a quoted field may contain
/// the delimiter, and a doubled quote is a literal quote.
List<List<String>> _parseCsv(String text) {
  final rows = <List<String>>[];
  var row = <String>[];
  final field = StringBuffer();
  var inQuotes = false;

  void endField() {
    row.add(field.toString());
    field.clear();
  }

  void endRow() {
    endField();
    if (row.any((cell) => cell.trim().isNotEmpty)) rows.add(row);
    row = <String>[];
  }

  for (var i = 0; i < text.length; i++) {
    final ch = text[i];
    if (inQuotes) {
      if (ch == '"') {
        if (i + 1 < text.length && text[i + 1] == '"') {
          field.write('"');
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field.write(ch);
      }
      continue;
    }
    if (ch == '"') {
      inQuotes = true;
      continue;
    }
    if (ch == ',') {
      endField();
      continue;
    }
    if (ch == '\n' || ch == '\r') {
      if (ch == '\r' && i + 1 < text.length && text[i + 1] == '\n') i++;
      endRow();
      continue;
    }
    field.write(ch);
  }
  if (field.isNotEmpty || row.isNotEmpty) endRow();
  return rows;
}
