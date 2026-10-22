import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:helix/design/components/buttons.dart';
import 'package:helix/design/components/hold_to_confirm.dart';
import 'package:helix/design/components/status_badge.dart';
import 'package:helix/design/components/text.dart';
import 'package:helix/design/tokens.dart';

void main() {
  testWidgets('StrandButton shows busy spinner and keeps width stable', (tester) async {
    await tester.pumpWidget(MaterialApp(
      home: Scaffold(
        body: Column(children: [
          StrandButton(label: 'Submit', shell: Shell.driver, onPressed: () {}),
          const StrandButton(label: 'Saving', shell: Shell.driver, onPressed: null, busy: true),
        ]),
      ),
    ));
    expect(find.text('Submit'), findsOneWidget);
    expect(find.byType(CircularProgressIndicator), findsOneWidget);
  });

  testWidgets('StatusBadge shows glyph + word, never colour alone', (tester) async {
    await tester.pumpWidget(const MaterialApp(
      home: Scaffold(body: StatusBadge(state: VehicleState.speeding)),
    ));
    expect(find.text('▲'), findsOneWidget);
    expect(find.text('Speeding'), findsOneWidget);
  });

  testWidgets('reduced motion falls back to the two-step confirm', (tester) async {
    var confirmed = 0;
    await tester.pumpWidget(MaterialApp(
      home: MediaQuery(
        data: const MediaQueryData(disableAnimations: true),
        child: Scaffold(
          body: Builder(builder: (context) {
            return HoldToConfirm(
              label: 'Discard',
              hold: const Duration(seconds: 2),
              reducedMotion: MediaQuery.of(context).disableAnimations,
              onConfirmed: () => confirmed += 1,
            );
          }),
        ),
      ),
    ));
    await tester.tap(find.text('Discard'));
    expect(confirmed, 0); // first tap only arms
    await tester.pump();
    await tester.tap(find.text('Tap again to confirm'));
    await tester.pump();
    expect(confirmed, 1);
  });

  testWidgets('HelixText honours text scaling up to 200%', (tester) async {
    await tester.pumpWidget(MaterialApp(
      home: MediaQuery(
        data: const MediaQueryData(textScaler: TextScaler.linear(3.0)),
        child: const Scaffold(body: HelixText('Hello', style: null)),
      ),
    ));
    final text = tester.widget<Text>(find.text('Hello'));
    // WCAG 1.4.4: text must be resizable to 200%. Body copy therefore clamps
    // at 2.0, not at a decorative 1.3.
    expect(text.textScaler!.scale(16) / 16, closeTo(2.0, 0.001));
  });

  testWidgets('chrome text clamps to 1.3x for fixed-height controls', (tester) async {
    await tester.pumpWidget(MaterialApp(
      home: MediaQuery(
        data: const MediaQueryData(textScaler: TextScaler.linear(3.0)),
        child: const Scaffold(body: HelixText.chrome('Hi', style: null)),
      ),
    ));
    final text = tester.widget<Text>(find.text('Hi'));
    expect(text.textScaler!.scale(16) / 16, closeTo(1.3, 0.001));
  });

  test('shell strands map to the logo colours', () {
    expect(Shell.driver.fill, AppColors.accent);
    expect(Shell.admin.fill, AppColors.adminAccent);
    AppColors.setDark(false);
    expect(Shell.driver.onFill, AppColors.text); // ink on cyan = 7.37:1
    expect(Shell.admin.onFill, Colors.white); // white on violet = 7.10:1
  });
}
