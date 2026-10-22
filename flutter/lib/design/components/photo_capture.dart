import 'package:flutter/material.dart';
import 'package:camera/camera.dart';
import 'package:permission_handler/permission_handler.dart';
import '../../i18n/strings.dart';
import '../tokens.dart';
import 'buttons.dart';
import 'text.dart';

/// Camera capture button → grant → camera view → captured bytes
/// (resize/compress happens in MediaService.stageCapture). No video mode (B-07).
class PhotoCapture extends StatefulWidget {
  const PhotoCapture({
    super.key,
    required this.cameras,
    required this.onCaptured,
    required this.label,
    this.captured,
    this.shell = Shell.driver,
  });

  final List<CameraDescription> cameras;
  final void Function(XFile file) onCaptured;
  final String label;
  final XFile? captured;
  final Shell shell;

  @override
  State<PhotoCapture> createState() => _PhotoCaptureState();
}

class _PhotoCaptureState extends State<PhotoCapture> {
  CameraController? _controller;
  bool _ready = false;
  bool _failed = false;

  @override
  void dispose() {
    _controller?.dispose();
    super.dispose();
  }

  Future<void> _openCamera() async {
    if (widget.cameras.isEmpty) {
      setState(() => _failed = true);
      return;
    }
    final permission = await Permission.camera.request();
    if (!permission.isGranted) {
      if (!mounted) return;
      setState(() => _failed = true);
      return;
    }
    final controller = CameraController(widget.cameras.first, ResolutionPreset.high);
    try {
      await controller.initialize();
      if (!mounted) {
        await controller.dispose();
        return;
      }
      setState(() {
        _controller = controller;
        _ready = true;
        _failed = false;
      });
    } catch (_) {
      await controller.dispose();
      if (!mounted) return;
      setState(() => _failed = true);
    }
  }

  Future<void> _shoot() async {
    final controller = _controller;
    if (controller == null || !controller.value.isInitialized) return;
    try {
      final file = await controller.takePicture();
      widget.onCaptured(file);
      if (!mounted) return;
      setState(() => _ready = false);
      _controller = null;
      await controller.dispose();
    } catch (_) {
      if (!mounted) return;
      setState(() => _failed = true);
    }
  }

  @override
  Widget build(BuildContext context) {
    final strings = Strings.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        HelixText(widget.label, style: TypeScale.caption(AppColors.textSecondary)),
        const SizedBox(height: AppSpace.s2),
        if (!_ready)
          QuietButton(
            label: _failed ? strings.t('camera.unavailable') : strings.t('camera.takePhoto'),
            onPressed: _failed ? null : _openCamera,
            icon: Icon(Icons.photo_camera_rounded, size: 20, color: AppColors.textSecondary),
          ),
        if (_ready && _controller != null)
          Column(
            children: [
              ClipRRect(
                borderRadius: BorderRadius.circular(AppRadius.card),
                child: AspectRatio(
                  aspectRatio: 3 / 4,
                  child: Semantics(
                    label: strings.t('camera.preview'),
                    child: CameraPreview(_controller!),
                  ),
                ),
              ),
              const SizedBox(height: AppSpace.s2),
              StrandButton(
                label: strings.t('camera.capture'),
                shell: widget.shell,
                onPressed: _shoot,
              ),
            ],
          ),
        if (widget.captured != null)
          Padding(
            padding: const EdgeInsets.only(top: AppSpace.s2),
            child: Row(
              children: [
                Icon(Icons.check_circle_rounded, color: AppColors.statusOk, size: 18),
                const SizedBox(width: AppSpace.s2),
                HelixText(
                  strings.t('camera.captured'),
                  style: TypeScale.caption(AppColors.statusOk),
                ),
              ],
            ),
          ),
      ],
    );
  }
}
