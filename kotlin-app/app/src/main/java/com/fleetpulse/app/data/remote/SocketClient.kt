package com.fleetpulse.app.data.remote

import android.util.Log
import com.fleetpulse.app.BuildConfig
import com.fleetpulse.app.data.ActiveShell
import com.fleetpulse.app.data.repo.FleetRepository
import io.socket.client.IO
import io.socket.client.Socket
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.serialization.json.Json
import org.json.JSONArray
import org.json.JSONObject
import java.net.URISyntaxException
import java.util.concurrent.TimeUnit

/**
 * Admin real-time surface. Prefers a real Socket.IO connection to the `ws` gateway
 * (docs/backend/07-websocket-gateway.md) using the Bearer access token, subscribing to the three
 * admin channels: `map:vehicle-states`, `notifications`, `accident:live`. If the socket.io-client
 * runtime is unavailable or the connection fails, it transparently falls back to HTTP polling of
 * `GET /dashboard/vehicle-states` + `GET /notifications` every 10s via the repository, per the
 * contract (drivers poll; admin uses socket but may degrade to polling).
 *
 * All updates are pushed into the repository's StateFlows, keeping it the single source of truth.
 */
class SocketClient(
    private val repository: FleetRepository,
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val json = Json { ignoreUnknownKeys = true }

    private var socket: Socket? = null
    private val _connectionState = MutableStateFlow<ConnectionState>(ConnectionState.Idle)
    val connectionState: StateFlow<ConnectionState> = _connectionState.asStateFlow()

    private var pollingJob: Job? = null
    private var usePolling = false

    sealed interface ConnectionState {
        object Idle : ConnectionState
        object Connecting : ConnectionState
        object ConnectedSocket : ConnectionState
        object ConnectedPolling : ConnectionState
        object Disconnected : ConnectionState
        data class Failed(val reason: String) : ConnectionState
    }

    fun connect(role: ActiveShell = ActiveShell.ADMIN) {
        if (role != ActiveShell.ADMIN) return
        if (_connectionState.value is ConnectionState.Connecting ||
            _connectionState.value is ConnectionState.ConnectedSocket ||
            _connectionState.value is ConnectionState.ConnectedPolling
        ) return
        _connectionState.value = ConnectionState.Connecting
        scope.launch {
            val token = SessionHolder.get()
            if (token.isNullOrBlank()) {
                _connectionState.value = ConnectionState.Failed("no session token")
                startPolling()
                return@launch
            }
            try {
                val opts = IO.Options().apply {
                    timeout = 8000
                    reconnection = true
                    reconnectionDelay = 2000
                    reconnectionDelayMax = 10000
                    auth = mapOf("token" to token)
                    transports = arrayOf("websocket")
                }
                val base = BuildConfig.API_BASE_URL.trimEnd('/')
                socket = IO.socket(base, opts).apply {
                    on(Socket.EVENT_CONNECT) { _connectionState.value = ConnectionState.ConnectedSocket }
                    on(Socket.EVENT_DISCONNECT) { _connectionState.value = ConnectionState.Disconnected; startPolling() }
                    on(Socket.EVENT_CONNECT_ERROR) {
                        Log.w("SocketClient", "connect error: ${it.firstOrNull()}")
                        _connectionState.value = ConnectionState.Failed(it.firstOrNull()?.toString() ?: "connect_error")
                        startPolling()
                    }
                    on("map:vehicle-states") { args -> handleVehicleStates(args) }
                    on("notifications") { args -> handleNotifications(args) }
                    on("accident:live") { args -> handleAccidentLive(args) }
                }
                socket?.connect()
            } catch (e: URISyntaxException) {
                _connectionState.value = ConnectionState.Failed(e.message ?: "bad uri")
                startPolling()
            } catch (e: Throwable) {
                // Socket.io-client may be missing at runtime; degrade to polling.
                Log.w("SocketClient", "socket unavailable, polling fallback", e)
                _connectionState.value = ConnectionState.Failed(e.message ?: "socket_error")
                startPolling()
            }
        }
    }

    private fun handleVehicleStates(args: Array<Any?>) {
        val payload = args.firstOrNull() ?: return
        val list: List<Map<String, Any?>> = when (payload) {
            is JSONArray -> (0 until payload.length()).mapNotNull { runCatching { jsonMapFrom(payload.getJSONObject(it)) }.getOrNull() }
            is JSONObject -> runCatching { listOf(jsonMapFrom(payload)) }.getOrNull() ?: emptyList()
            else -> emptyList()
        }
        repository.applyVehicleStates(list)
    }

    private fun handleNotifications(args: Array<Any?>) {
        val payload = args.firstOrNull() ?: return
        val list: List<Map<String, Any?>> = when (payload) {
            is JSONArray -> (0 until payload.length()).mapNotNull { runCatching { jsonMapFrom(payload.getJSONObject(it)) }.getOrNull() }
            is JSONObject -> runCatching { listOf(jsonMapFrom(payload)) }.getOrNull() ?: emptyList()
            else -> emptyList()
        }
        repository.applyNotifications(list)
    }

    private fun handleAccidentLive(args: Array<Any?>) {
        val payload = args.firstOrNull() ?: return
        val map = (payload as? JSONObject)?.let { runCatching { jsonMapFrom(it) }.getOrNull() } ?: return
        repository.applyAccidentLive(map)
    }

    private fun jsonMapFrom(o: JSONObject): Map<String, Any?> {
        val out = mutableMapOf<String, Any?>()
        o.keys().forEach { k -> out[k] = o.opt(k)?.takeUnless { it === JSONObject.NULL } }
        return out
    }

    private fun startPolling() {
        if (usePolling) return
        usePolling = true
        _connectionState.value = ConnectionState.ConnectedPolling
        pollingJob?.cancel()
        pollingJob = scope.launch {
            while (isActive) {
                repository.pollAdminRealtime()
                delay(10_000)
            }
        }
    }

    fun disconnect() {
        pollingJob?.cancel()
        pollingJob = null
        usePolling = false
        runCatching { socket?.disconnect() }
        runCatching { socket?.off() }
        socket = null
        _connectionState.value = ConnectionState.Disconnected
    }
}
