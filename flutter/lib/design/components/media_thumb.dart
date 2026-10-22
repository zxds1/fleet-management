import 'package:flutter/material.dart';
import '../../core/api_client.dart';
import '../../i18n/strings.dart';
import '../tokens.dart';

/// Resolves the media 302 (token stripped) and caches the image.
class MediaThumb extends StatefulWidget {
  const MediaThumb({super.key, required this.mediaId, this.size = 72, this.onTap});

  final String mediaId;
  final double size;
  final VoidCallback? onTap;

  @override
  State<MediaThumb> createState() => _MediaThumbState();
}

class _MediaThumbState extends State<MediaThumb> {
  String? _url;
  bool _failed = false;
  bool _resolving = false;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _resolve();
  }

  Future<void> _resolve() async {
    if (_resolving || _url != null) return;
    _resolving = true;
    final api = InheritedApi.of(context);
    try {
      final url = await api.resolveMediaUrl(widget.mediaId);
      if (!mounted) return;
      setState(() => _url = url);
    } catch (_) {
      if (!mounted) return;
      setState(() => _failed = true);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Semantics(
      label: Strings.of(context).t('detail.photo'),
      image: true,
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTap: widget.onTap,
        child: Container(
          width: widget.size,
          height: widget.size,
          decoration: BoxDecoration(
            color: AppColors.surfaceSunk,
            borderRadius: BorderRadius.circular(AppRadius.control),
            border: Border.all(color: AppColors.line),
          ),
          clipBehavior: Clip.antiAlias,
          child: _url == null
              ? Center(
                  child: Icon(
                    _failed ? Icons.broken_image_rounded : Icons.image_rounded,
                    color: AppColors.textTertiary,
                  ),
                )
              : Image.network(
                  _url!,
                  fit: BoxFit.cover,
                  errorBuilder: (_, _, _) => Center(
                    child: Icon(
                      Icons.broken_image_rounded,
                      color: AppColors.textTertiary,
                    ),
                  ),
                ),
        ),
      ),
    );
  }
}

/// Provides the ApiClient to widgets without threading it manually.
class InheritedApi extends InheritedWidget {
  const InheritedApi({super.key, required this.api, required super.child});

  final ApiClient api;

  static ApiClient of(BuildContext context) {
    final widget = context.dependOnInheritedWidgetOfExactType<InheritedApi>();
    assert(widget != null, 'InheritedApi missing above this widget');
    return widget!.api;
  }

  @override
  bool updateShouldNotify(InheritedApi oldWidget) => oldWidget.api != api;
}
