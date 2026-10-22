import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../app/providers.dart';
import '../../core/errors.dart';
import '../../data/providers.dart';
import '../../design/components/paged_list.dart';
import '../../design/components/text.dart';
import '../../design/components/status_badge.dart';
import '../../design/tokens.dart';
import '../common.dart';
import '../../i18n/strings.dart';

/// Training lessons + roster entry.
///
/// Admins holding `training:manage` also upload training from this same screen: the
/// "Create lesson" form sits above the catalogue, sets the lesson's course, code, title,
/// description, content URL, duration and order — i.e. the rules the driver must complete.
/// Drivers only see the catalogue and their own completion actions.
class TrainingScreen extends ConsumerStatefulWidget {
  const TrainingScreen({super.key});

  @override
  ConsumerState<TrainingScreen> createState() => _TrainingScreenState();
}

class _TrainingScreenState extends ConsumerState<TrainingScreen> {
  final _formKey = GlobalKey<FormState>();
  final _codeCtrl = TextEditingController();
  final _titleCtrl = TextEditingController();
  final _descCtrl = TextEditingController();
  final _urlCtrl = TextEditingController();
  final _durCtrl = TextEditingController();
  String? _courseId;
  bool _saving = false;
  bool _canManage = false;

  @override
  void dispose() {
    _codeCtrl.dispose();
    _titleCtrl.dispose();
    _descCtrl.dispose();
    _urlCtrl.dispose();
    _durCtrl.dispose();
    super.dispose();
  }

  Future<void> _createLesson(Strings strings) async {
    if (!_formKey.currentState!.validate()) return;
    if (_courseId == null) return;
    setState(() => _saving = true);
    try {
      await ref.read(repositoryProvider).createTrainingLesson({
        'course_id': _courseId,
        'code': _codeCtrl.text.trim(),
        'title': _titleCtrl.text.trim(),
        'description': _descCtrl.text.trim().isEmpty ? null : _descCtrl.text.trim(),
        'content_url': _urlCtrl.text.trim().isEmpty ? null : _urlCtrl.text.trim(),
        'duration_minutes': _durCtrl.text.trim().isEmpty ? null : int.tryParse(_durCtrl.text.trim()),
        'order_index': 0,
      });
      if (!mounted) return;
      ref.invalidate(_lessonsProvider);
      _codeCtrl.clear();
      _titleCtrl.clear();
      _descCtrl.clear();
      _urlCtrl.clear();
      _durCtrl.clear();
      setState(() => _courseId = null);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: HelixText(strings.t('training.created'), style: TypeScale.body(AppColors.text))),
      );
    } on HelixError catch (e) {
      if (mounted) showHelixError(context, e);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final strings = Strings.of(context);
    _canManage = ref.read(sessionProvider).permissions.contains('training:manage');
    final canComplete = ref.read(sessionProvider).permissions.contains('training:complete');
    final canReview = ref.read(sessionProvider).permissions.contains('training:review');
    final coursesAsync = ref.watch(_coursesProvider);
    final courses = coursesAsync.value ?? const <Map<String, dynamic>>[];

    return Scaffold(
      appBar: AppBar(
        title: HelixText(strings.t('training.title'), style: TypeScale.title(AppColors.text)),
        backgroundColor: AppColors.surface,
        actions: [
          if (canReview)
            TextButton(
              onPressed: () => context.push('/admin/training/roster'),
              child: HelixText(strings.t('training.roster'), style: TypeScale.button(AppColors.adminAccent)),
            ),
        ],
      ),
      body: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // ── Admin: upload training + set the enforced rules (same screen) ──────────
          if (_canManage) ...[
            Container(
              color: AppColors.surfaceSunk,
              padding: const EdgeInsets.all(AppSpace.s4),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  HelixText(strings.t('training.upload'), style: TypeScale.title(AppColors.text)),
                  const SizedBox(height: AppSpace.s3),
                  HelixText(
                    strings.t('training.upload_hint'),
                    style: TypeScale.caption(AppColors.textSecondary),
                  ),
                  const SizedBox(height: AppSpace.s4),
                  Form(
                    key: _formKey,
                    child: Column(
                      children: [
                          DropdownButtonFormField<String>(
                          initialValue: _courseId,
                          hint: HelixText(strings.t('training.course'), style: TypeScale.body(AppColors.text)),
                          items: courses
                              .map((c) => DropdownMenuItem(
                                    value: c['id'] as String?,
                                    child: HelixText(
                                      '${c['code'] ?? ''} · ${c['title'] ?? ''}',
                                      style: TypeScale.body(AppColors.text),
                                    ),
                                  ))
                              .toList(),
                          onChanged: courses.isEmpty ? null : (v) => setState(() => _courseId = v),
                          validator: (v) => v == null ? strings.t('training.course_required') : null,
                          decoration: const InputDecoration(border: OutlineInputBorder()),
                        ),
                        const SizedBox(height: AppSpace.s3),
                        TextFormField(
                          controller: _codeCtrl,
                          decoration: InputDecoration(labelText: strings.t('training.code')),
                          validator: (v) => v == null || v.isEmpty ? strings.t('training.code_required') : null,
                        ),
                        const SizedBox(height: AppSpace.s3),
                        TextFormField(
                          controller: _titleCtrl,
                          decoration: InputDecoration(labelText: strings.t('training.lesson_title')),
                          validator: (v) => v == null || v.isEmpty ? strings.t('training.lesson_title_required') : null,
                        ),
                        const SizedBox(height: AppSpace.s3),
                        TextFormField(
                          controller: _descCtrl,
                          decoration: InputDecoration(labelText: strings.t('training.description')),
                          maxLines: 2,
                        ),
                        const SizedBox(height: AppSpace.s3),
                        TextFormField(
                          controller: _urlCtrl,
                          decoration: InputDecoration(labelText: strings.t('training.content_url')),
                          keyboardType: TextInputType.url,
                        ),
                        const SizedBox(height: AppSpace.s3),
                        Row(
                          children: [
                            Expanded(
                              child: TextFormField(
                                controller: _durCtrl,
                                decoration: InputDecoration(labelText: strings.t('training.duration_min')),
                                keyboardType: TextInputType.number,
                              ),
                            ),
                            const SizedBox(width: AppSpace.s3),
                            SizedBox(
                              width: 110,
                              child: FilledButton(
                                onPressed: _saving ? null : () => _createLesson(strings),
                                child: HelixText(
                                  _saving ? strings.t('training.saving') : strings.t('training.create'),
                                  style: TypeScale.button(AppColors.textInverse),
                                ),
                              ),
                            ),
                          ],
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: AppSpace.s4),
          ],

          // ── Lesson catalogue (drivers complete; admins see what they uploaded) ─────
          Expanded(
            child: PagedList<Map<String, dynamic>>(
              emptyMessage: strings.t('training.empty'),
              loadMore: (cursor) async {
                try {
                  return await ref.read(repositoryProvider).page('training/lessons', cursor: cursor);
                } on HelixError catch (e) {
                  throw HelixErrorLike(strings.error(e.code), actionLabel: strings.t(e.catalogue.i18nKey));
                }
              },
              itemBuilder: (context, row) {
                final mandatory = row['is_mandatory'] == true;
                return ListTile(
                  leading: mandatory ? HelixChip(label: '!', color: AppColors.statusDanger) : null,
                  title: HelixText(row['title']?.toString() ?? '', style: TypeScale.body(AppColors.text)),
                  subtitle: HelixText(
                    '${row['course_title'] ?? ''} · ${row['duration_minutes'] ?? 0} ${strings.t('training.minutes')}',
                    style: TypeScale.caption(AppColors.textSecondary),
                  ),
                  trailing: canComplete
                      ? OutlinedButton(
                          onPressed: () async {
                            try {
                              await ref.read(repositoryProvider).completeTraining(row['id'] as String);
                              if (context.mounted) ref.invalidate(_lessonsProvider);
                            } on HelixError catch (e) {
                              if (context.mounted) showHelixError(context, e);
                            }
                          },
                          child: HelixText(strings.t('training.complete'), style: TypeScale.button(AppColors.adminAccent)),
                        )
                      : null,
                );
              },
            ),
          ),
        ],
      ),
    );
  }
}

final _lessonsProvider = FutureProvider<List<Map<String, dynamic>>>((ref) async {
  final page = await ref.watch(repositoryProvider).page('training/lessons');
  return page.data;
});

final _coursesProvider = FutureProvider<List<Map<String, dynamic>>>((ref) async {
  final page = await ref.watch(repositoryProvider).trainingCourses();
  return (page['data'] as List?)?.cast<Map<String, dynamic>>() ?? const [];
});
