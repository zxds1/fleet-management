import 'dart:math' as math;
import 'package:flutter/material.dart';
import 'package:flutter/physics.dart';


/// Spring physics tuned to Apple's damping-ratio / response model.
///
/// - Damping ratio: 1.0 = critically damped (no overshoot); <1.0 bounces.
///   Use 0.8 only for momentum-driven interactions (flicks, drag releases);
///   overshoot on a menu that just faded in feels wrong.
/// - Response: seconds to reach the target. This is not a fixed duration —
///   settle time emerges from the parameters.
class AppSpring {
  AppSpring._();

  static const double mass = 1.0;

  /// Default UI spring: graceful, non-distracting, no overshoot.
  static SpringDescription ui({double damping = 1.0, double response = 0.35}) =>
      _spring(damping, response);

  /// Sheets, drawers, momentum releases: slight overshoot feels physical.
  static SpringDescription drawer({double damping = 0.8, double response = 0.30}) =>
      _spring(damping, response);

  /// Fast flicks where you want to "throw" an element to its rest point.
  static SpringDescription flick({double damping = 0.75, double response = 0.40}) =>
      _spring(damping, response);

  static SpringDescription _spring(double damping, double response) {
    // Approximate Apple mapping: natural frequency from response, damping from ratio.
    // Critically damped settles roughly within response seconds (~4/(ζ·ω0)).
    final w0 = 5.0 / response;
    final stiffness = w0 * w0 * mass;
    final dampingC = 2.0 * damping * math.sqrt(stiffness * mass);
    return SpringDescription(mass: mass, stiffness: stiffness, damping: dampingC);
  }
}

/// When a gesture ends, continue the spring at the finger's exact velocity so
/// there is no seam between dragging and animating.
///
/// The animated value runs *opposite* to the pixel axis in both the sheet
/// (offset = height × (1 − value)) and the swipe row (offset = −value ×
/// width): dragging down opens nothing, it closes. So the handoff inverts the
/// sign and divides by the number of pixels one unit of value spans, which is
/// what puts the spring back on the path the finger was already travelling.
double gestureVelocityToValue(double gestureVelocityPxPerSecond, double pixelsPerValueUnit) {
  if (pixelsPerValueUnit == 0) return 0;
  return -gestureVelocityPxPerSecond / pixelsPerValueUnit;
}

/// Momentum projection (Apple's exponential-decay form from Designing Fluid
/// Interfaces) — land where the gesture is going, not where it released.
double projectEndpoint(double currentPosition, double releaseVelocity,
    {double decelerationRate = 0.998}) {
  return currentPosition + (releaseVelocity / 1000) * decelerationRate / (1 - decelerationRate);
}

/// Soft boundary: resist progressively past the edge instead of hard-stopping.
double rubberBand(double overshoot, double dimension, {double constant = 0.55}) {
  return (overshoot * dimension * constant) / (dimension + constant * overshoot.abs());
}

/// Drives [controller] toward [target] as an interruptible spring starting from
/// its live on-screen value and velocity — safe to retarget mid-flight without
/// the "brick wall" velocity discontinuity. The animation drives rebuilds through
/// the controller's listener, so callers do not need [setState].
Future<void> springTo(AnimationController controller, double target,
    {SpringDescription? description, double? velocity}) {
  return controller.animateWith(
    SpringSimulation(
      description ?? AppSpring.ui(),
      controller.value,
      target,
      velocity ?? controller.velocity,
    ),
  );
}
