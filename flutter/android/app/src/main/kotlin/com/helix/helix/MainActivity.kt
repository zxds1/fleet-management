package com.helix.helix

import android.view.WindowManager
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

class MainActivity : FlutterActivity() {

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, PRIVACY_CHANNEL)
            .setMethodCallHandler { call, result ->
                when (call.method) {
                    "protect" -> {
                        setScreenCaptureProtected(true)
                        result.success(null)
                    }
                    "unprotect" -> {
                        setScreenCaptureProtected(false)
                        result.success(null)
                    }
                    else -> result.notImplemented()
                }
            }
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, SECURITY_CHANNEL)
            .setMethodCallHandler { call, result ->
                when (call.method) {
                    "probe" -> {
                        val probe = SecurityProbe.probe()
                        result.success(
                            mapOf(
                                "rooted" to probe.rooted,
                                "hooked" to probe.hooked,
                                "debuggerAttached" to probe.debuggerAttached,
                                "reason" to probe.reason
                            )
                        )
                    }
                    else -> result.notImplemented()
                }
            }
    }

    private fun setScreenCaptureProtected(enabled: Boolean) {
        if (enabled) {
            window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
        } else {
            window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
        }
    }

    override fun onDestroy() {
        window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
        super.onDestroy()
    }

    companion object {
        const val PRIVACY_CHANNEL = "helix/privacy"
        const val SECURITY_CHANNEL = "helix/security"
    }
}
