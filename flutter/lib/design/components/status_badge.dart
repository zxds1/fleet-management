import 'package:flutter/material.dart';
import '../tokens.dart';
import '../../i18n/strings.dart';
import 'text.dart';

/// N5 vehicle display states. Colour + glyph + word, never colour alone.
enum VehicleState {
  quarantined,
  offline,
  hosAlert,
  speeding,
  moving,
  idling,
  parked,
}

class _StateVisual {
  _StateVisual(this.glyph, this.color, this.labelKey);
  final String glyph;
  final Color color;
  final String labelKey;
}

final Map<VehicleState, _StateVisual> _visuals = {
  VehicleState.quarantined: _StateVisual('✕', AppColors.statusPlum, 'status.QUARANTINED'),
  VehicleState.offline: _StateVisual('○', AppColors.statusNeutral, 'status.OFFLINE'),
  VehicleState.hosAlert: _StateVisual('!', AppColors.statusAmber, 'status.HOS_ALERT'),
  VehicleState.speeding: _StateVisual('▲', AppColors.statusDanger, 'status.SPEEDING'),
  VehicleState.moving: _StateVisual('►', AppColors.statusOk, 'status.MOVING'),
  VehicleState.idling: _StateVisual('❚❚', AppColors.statusOlive, 'status.IDLING'),
  VehicleState.parked: _StateVisual('P', AppColors.statusInfo, 'status.PARKED'),
};

VehicleState? vehicleStateFromName(String? name) {
  if (name == null) return null;
  switch (name.toUpperCase()) {
    case 'QUARANTINED':
      return VehicleState.quarantined;
    case 'OFFLINE':
      return VehicleState.offline;
    case 'HOS_ALERT':
      return VehicleState.hosAlert;
    case 'SPEEDING':
      return VehicleState.speeding;
    case 'MOVING':
      return VehicleState.moving;
    case 'IDLING':
      return VehicleState.idling;
    case 'PARKED':
      return VehicleState.parked;
    default:
      return null;
  }
}

class StatusBadge extends StatelessWidget {
  const StatusBadge({super.key, required this.state, this.dense = false});

  final VehicleState state;
  final bool dense;

  @override
  Widget build(BuildContext context) {
    final visual = _visuals[state]!;
    return Container(
      padding: EdgeInsets.symmetric(
        horizontal: dense ? AppSpace.s2 : AppSpace.s3,
        vertical: dense ? AppSpace.s1 : AppSpace.s2,
      ),
      constraints: const BoxConstraints(minHeight: AppTarget.badge),
      decoration: BoxDecoration(
        color: AppColors.surfaceSunk,
        borderRadius: BorderRadius.circular(AppRadius.full),
        border: Border.all(color: AppColors.line),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          ExcludeSemantics(
            child: HelixText.chrome(visual.glyph, style: TypeScale.numeral(visual.color)),
          ),
          const SizedBox(width: AppSpace.s2),
          HelixText(
            Strings.of(context).t(visual.labelKey),
            style: TypeScale.caption(visual.color),
          ),
        ],
      ),
    );
  }
}

/// Generic semantic chip (priority tiers, verification status, severity).
class HelixChip extends StatelessWidget {
  const HelixChip({super.key, required this.label, this.color, this.glyph});

  final String label;
  final Color? color;
  final String? glyph;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      label: label,
      excludeSemantics: true,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: AppSpace.s3, vertical: AppSpace.s2),
        constraints: const BoxConstraints(minHeight: AppTarget.badge),
        decoration: BoxDecoration(
          color: AppColors.surfaceSunk,
          borderRadius: BorderRadius.circular(AppRadius.full),
          border: Border.all(color: AppColors.line),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (glyph != null) ...[
              ExcludeSemantics(
                child: HelixText.chrome(
                  glyph!,
                  style: TypeScale.numeral(color ?? AppColors.textSecondary),
                ),
              ),
              const SizedBox(width: AppSpace.s2),
            ],
            HelixText(label, style: TypeScale.caption(color ?? AppColors.textSecondary)),
          ],
        ),
      ),
    );
  }
}

/// Convenience wrapper for a nullable display_state string.
class VehicleStateChip extends StatelessWidget {
  const VehicleStateChip(this.state, {super.key});

  final String? state;

  @override
  Widget build(BuildContext context) {
    final parsed = vehicleStateFromName(state);
    if (parsed == null) return const SizedBox.shrink();
    return StatusBadge(state: parsed);
  }
}
