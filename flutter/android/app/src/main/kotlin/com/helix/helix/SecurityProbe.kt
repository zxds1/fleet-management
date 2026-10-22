package com.helix.helix

import android.os.Build
import android.os.Debug
import java.io.File

/**
 * Device-integrity probe. Answers "does this device look rooted, hooked or
 * debugged?" for the release-build gate.
 *
 * Every individual check is wrapped: a failure yields "not detected" rather
 * than an exception, because a false positive locks a legitimate driver out
 * of the app and the probe must never be the reason the app fails to start.
 */
object SecurityProbe {

    private val rootBinaries = listOf(
        "su", "magisk", "magiskinit", "daemonsu", "supersu", "busybox", "frida-server"
    )

    private val rootPaths = listOf(
        "/system/bin", "/system/xbin", "/sbin", "/su/bin", "/system/sbin",
        "/data/local", "/data/local/bin"
    )

    private val rootFiles = listOf(
        "/system/app/Superuser.apk", "/system/xbin/su", "/system/bin/.ext/.su",
        "/system/bin/failsafe", "/data/adb"
    )

    private val hookingMarkers = listOf("frida", "xposed", "substrate", "libcydia")

    data class Result(
        val rooted: Boolean,
        val hooked: Boolean,
        val debuggerAttached: Boolean,
        val reason: String
    )

    fun probe(): Result {
        val reasons = mutableListOf<String>()

        val rooted = detectRoot(reasons)
        val hooked = detectHooking(reasons)
        val debugger = detectDebugger()

        return Result(
            rooted = rooted,
            hooked = hooked,
            debuggerAttached = debugger,
            reason = reasons.joinToString("; ")
        )
    }

    private fun detectRoot(reasons: MutableList<String>): Boolean = runCatching {
        var found = false

        for (dir in rootPaths) {
            for (binary in rootBinaries) {
                if (File(dir, binary).exists()) {
                    reasons += "root binary $dir/$binary"
                    found = true
                }
            }
        }
        for (path in rootFiles) {
            if (File(path).exists()) {
                reasons += "root path $path"
                found = true
            }
        }

        if (Build.TAGS?.contains("test-keys") == true) {
            reasons += "test-keys build"
            found = true
        }

        val props = readBuildProps()
        if (props["ro.debuggable"] == "1" && props["ro.secure"] == "0") {
            reasons += "debuggable system image"
            found = true
        }

        found
    }.getOrElse { false }

    /**
     * Reads the system build properties without reflection: `android.os.SystemProperties`
     * is a hidden API, so the property files are read instead.
     */
    private fun readBuildProps(): Map<String, String> {
        val out = mutableMapOf<String, String>()
        for (path in listOf("/system/build.prop", "/prop.default/build.prop", "/vendor/build.prop")) {
            runCatching {
                File(path).forEachLine { line ->
                    val trimmed = line.trim()
                    if (trimmed.isEmpty() || trimmed.startsWith("#")) return@forEachLine
                    val index = trimmed.indexOf('=')
                    if (index <= 0) return@forEachLine
                    out[trimmed.substring(0, index)] = trimmed.substring(index + 1)
                }
            }
        }
        return out
    }

    private fun detectHooking(reasons: MutableList<String>): Boolean = runCatching {
        val maps = runCatching { File("/proc/self/maps").readText() }.getOrDefault("")
        if (maps.isEmpty()) return@runCatching false
        val lower = maps.lowercase()
        val hit = hookingMarkers.firstOrNull { lower.contains(it) }
        if (hit != null) {
            reasons += "hooking marker $hit in /proc/self/maps"
            return@runCatching true
        }
        false
    }.getOrElse { false }

    private fun detectDebugger(): Boolean = runCatching {
        Debug.isDebuggerConnected() || Debug.waitingForDebugger()
    }.getOrElse { false }
}
