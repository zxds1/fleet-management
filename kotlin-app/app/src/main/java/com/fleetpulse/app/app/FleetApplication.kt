package com.fleetpulse.app.app

import android.app.Application
import com.fleetpulse.app.data.repo.FleetRepository

/**
 * Single-process application. Holds the repository instance (manual DI — no Hilt to keep the build
 * simple and the stub's toolchain unchanged). Exposes [repository] for Compose via composition local
 * or direct access.
 */
class FleetApplication : Application() {
    val repository: FleetRepository by lazy { FleetRepository(this) }

    override fun onCreate() {
        super.onCreate()
        // Repository init is lazy; first access triggers session restore + queue drainer.
    }
}
