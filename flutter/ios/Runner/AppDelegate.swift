import Flutter
import UIKit


/// Device-integrity probe for iOS.
///
/// iOS is Phase 2 for this product, so this is the same advisory contract the
/// Android probe implements: answer "does this device look jailbroken,
/// hooked or debugged?" and never throw. A false positive would lock a
/// legitimate driver out of the app.
enum SecurityProbe {

  struct Result {
    let rooted: Bool
    let hooked: Bool
    let debuggerAttached: Bool
    let reason: String
  }

  private static let jailbreakPaths = [
    "/Applications/Cydia.app",
    "/Applications/Sileo.app",
    "/Applications/Zebra.app",
    "/Library/MobileSubstrate/MobileSubstrate.dylib",
    "/bin/bash",
    "/usr/sbin/sshd",
    "/etc/apt",
    "/private/var/lib/apt",
    "/private/var/lib/cydia",
    "/usr/libexec/ssh-keys",
    "/usr/libexec/sshd",
    "/private/var/stash",
  ]

  private static let hookingPaths = [
    "/usr/lib/libhooker.dylib",
    "/Library/MobileSubstrate/MobileSubstrate.dylib",
  ]

  static func probe() -> Result {
    var reasons: [String] = []

    let rooted = detectJailbreak(&reasons)
    let hooked = detectHooking(&reasons)
    let debugger = detectDebugger()

    return Result(
      rooted: rooted,
      hooked: hooked,
      debuggerAttached: debugger,
      reason: reasons.joined(separator: "; ")
    )
  }

  private static func detectJailbreak(_ reasons: inout [String]) -> Bool {
    var found = false

    for path in jailbreakPaths where FileManager.default.fileExists(atPath: path) {
      reasons.append("jailbreak path \(path)")
      found = true
    }

    if canWriteOutsideSandbox() {
      reasons.append("writable outside the sandbox")
      found = true
    }

    return found
  }

  /// A stock device's sandbox makes `/private` unwritable. If a file can be
  /// created there, the sandbox has been broken.
  private static func canWriteOutsideSandbox() -> Bool {
    let probe = "/private/helix-probe-\(UUID().uuidString)"
    guard (try? "probe".write(toFile: probe, atomically: true, encoding: .utf8)) != nil else {
      return false
    }
    try? FileManager.default.removeItem(atPath: probe)
    return true
  }

  private static func detectHooking(_ reasons: inout [String]) -> Bool {
    var found = false

    for path in hookingPaths where FileManager.default.fileExists(atPath: path) {
      reasons.append("hooking library \(path)")
      found = true
    }

    if getenv("DYLD_INSERT_LIBRARIES") != nil {
      reasons.append("DYLD_INSERT_LIBRARIES is set")
      found = true
    }

    return found
  }

  /// A debugger attached to this process sets P_TRACED in the kernel's process
  /// flags. `ptrace(PT_DENY_ATTACH)` would be the other way to ask, but it
  /// cannot be undone for the life of the process, so the flag is read instead.
  private static func detectDebugger() -> Bool {
    // P_TRACED from <sys/proc.h>; spelled out so the probe does not depend on
    // the symbol being re-exported by the Darwin module.
    let traced: Int32 = 0x0000_0800

    var info = kinfo_proc()
    var mib: [Int32] = [CTL_KERN, KERN_PROC, KERN_PROC_PID, getpid()]
    var size = MemoryLayout<kinfo_proc>.stride

    let result = sysctl(&mib, UInt32(mib.count), &info, &size, nil, 0)
    guard result == 0 else { return false }

    return (info.kp_proc.p_flag & traced) != 0
  }
}

@main
@objc class AppDelegate: FlutterAppDelegate, FlutterImplicitEngineDelegate {
  override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
  ) -> Bool {
    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

  func didInitializeImplicitFlutterEngine(_ engineBridge: FlutterImplicitEngineBridge) {
    GeneratedPluginRegistrant.register(with: engineBridge.pluginRegistry)

    let channel = FlutterMethodChannel(
      name: "helix/security",
      binaryMessenger: engineBridge.applicationBinaryMessenger
    )
    channel.setMethodCallHandler { call, result in
      guard call.method == "probe" else {
        result(FlutterMethodNotImplemented)
        return
      }
      let probe = SecurityProbe.probe()
      result([
        "rooted": probe.rooted,
        "hooked": probe.hooked,
        "debuggerAttached": probe.debuggerAttached,
        "reason": probe.reason,
      ])
    }
  }
}
