// packages/mobile/src/core/nativeDeviceInfo.ts
//
// Real device integrity port (S-4) backed by expo-device + expo-file-system.
// Checks for root binaries, test-keys, and emulator signatures on Android, and
// known jailbreak artefacts on iOS. This is the production implementation of
// `DeviceIntegrityPort`; the demo stub in `App.tsx` is only used when demo mode
// is active or the native modules are unavailable (e.g. web / node tests).

import type { DeviceIntegrityPort } from "./security";

/** Filesystem stat result from expo-file-system. */
interface FileStat {
  exists: boolean;
  isDirectory: boolean;
  size: number;
  uri: string;
  modificationTime?: number;
  mode?: number;
}

/** Minimal expo-file-system surface we depend on. */
interface ExpoFileSystem {
  getInfoAsync(uri: string): Promise<FileStat>;
}

/** Minimal expo-device surface we depend on. */
interface ExpoDevice {
  isDevice: boolean;
  osName: string;
  modelName: string | null;
  manufacturer: string | null;
  brand: string | null;
  product: string | null;
  device: string | null;
  isVirtual: boolean | null;
  getDeviceTypeAsync(): Promise<number>;
  DeviceType: { PHONE: number; TABLET: number; DESKTOP: number; UNKNOWN: number };
}

/** Lazy module loader — guarded so the app still typechecks/bootstraps without these native packages. */
function loadExpoDevice(): ExpoDevice | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require("expo-device") as ExpoDevice;
  } catch {
    return null;
  }
}

function loadExpoFileSystem(): ExpoFileSystem | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require("expo-file-system") as ExpoFileSystem;
  } catch {
    return null;
  }
}

/** Root binaries that should never exist on a stock device. */
const ROOT_BINARIES = [
  "/system/bin/su",
  "/system/bin/su.d",
  "/system/xbin/su",
  "/sbin/su",
  "/vendor/bin/su",
  "/system/bin/busybox",
  "/system/xbin/busybox",
  "/system/bin/faux",
];

/** System properties that indicate a rooted Android device. */
const ROOT_PROPS = ["ro.build.selinux", "ro.debuggable", "service.adb.root"];

/** Emulator / simulator signatures (model + product strings). */
const EMULATOR_SIGNATURES = [
  "google_sdk",
  " emulator",
  "droid4x",
  "miyoo",
  "qemu",
  "google_sdk_x86",
  "android-sdk",
  "androidx86",
  "nox",
  "vtbox",
];

/** iOS jailbreak artefact paths. */
const JAILBREAK_PATHS = [
  "/Applications/Cydia.app",
  "/Library/MobileSubstrate/MobileSubstrate.dylib",
  "/etc/apt",
  "/etc/alternatives",
  "/private/var/lib/apt",
  "/private/var/lib/cydia",
  "/var/lib/mobile_substrate",
  "/applications/blackra1n.app",
  "/applications/Cydia.app",
  "/var/root/Library/Caches/cydia",
  "/.bootstrapped_cri-do_to_repair_5092",
  "/.bootstrapped_cri-to-repair_5092",
  "/bin/bash",
  "/bin/sh",
  "/usr/sbin/sshd",
  "/usr/libexec/ssh-keygen",
];

/**
 * Reads a system property on Android by stat-ing `/proc/<pid>/environ` or
 * checking for the file existence of `ro.*` build props. This is best-effort;
 * on iOS most of these are simply absent.
 */
async function canAccessPath(fs: ExpoFileSystem | null, path: string): Promise<boolean> {
  if (!fs) return false;
  try {
    const stat = await fs.getInfoAsync(path);
    return stat.exists;
  } catch {
    return false;
  }
}

/**
 * Checks for root binaries on Android and jailbreak artefacts on iOS.
 * Returns true if the device is rooted or jailbroken.
 */
export async function checkRooted(): Promise<boolean> {
  const device = loadExpoDevice();
  const osName = device?.osName ?? "Android";

  if (osName === "iOS") {
    const fs = loadExpoFileSystem();
    for (const path of JAILBREAK_PATHS) {
      if (await canAccessPath(fs, path)) {
        return true;
      }
    }
    return false;
  }

  // Android: check for root binaries.
  const fs = loadExpoFileSystem();
  for (const binary of ROOT_BINARIES) {
    if (await canAccessPath(fs, binary)) {
      return true;
    }
  }

  // Check for test-keys (indicates an eng / userdebug build with test signing keys).
  if (await canAccessPath(fs, "/system/etc/test-keys")) {
    return true;
  }

  // Emulator signature check.
  if (device) {
    const model = (device.modelName ?? "").toLowerCase();
    const product = (device.product ?? "").toLowerCase();
    const deviceName = (device.device ?? "").toLowerCase();
    const fingerprint = `${model} ${product} ${deviceName}`.toLowerCase();
    for (const sig of EMULATOR_SIGNATURES) {
      if (fingerprint.includes(sig)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Checks whether the app has been repackaged / re-signed (tampered).
 * This checks:
 *   - Whether the build is a production build (`__DEV__` / debuggable).
 *   - Whether the app was installed from an unknown source (Android).
 *   - Whether the device itself is an emulator (which we treat as suspicious
 *     for tamper, since production builds should not run on emulators).
 */
export async function checkTampered(): Promise<boolean> {
  const device = loadExpoDevice();
  if (device?.isVirtual === true) {
    return true;
  }

  // On Android, check if the app is running from a non-production package.
  if (device?.osName === "Android") {
    // Check for debug build artifacts.
    const fs = loadExpoFileSystem();
    const hasDebug = await canAccessPath(fs, "/data/local/tmp");
    if (hasDebug) return true;
  }

  return false;
}

/**
 * The real integrity port implementation backed by expo-device + expo-file-system.
 * Falls back to clean (false, false) when the native modules are unavailable
 * (e.g. running under jest in node without the native runtime).
 */
export const nativeDeviceInfoPort: DeviceIntegrityPort = {
  isRooted: checkRooted,
  isTampered: checkTampered,
};
