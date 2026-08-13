package com.fleetpulse.app.data.remote

import com.fleetpulse.app.BuildConfig
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.serialization.json.Json
import okhttp3.Interceptor
import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import java.util.UUID
import java.util.concurrent.TimeUnit

/**
 * Holds the active session token and exposes it to the auth interceptor. Mirrors the Expo
 * [getToken] port: returns null when offline / not yet authed.
 */
object SessionHolder {
    private val _accessToken = MutableStateFlow<String?>(null)
    val accessToken: StateFlow<String?> = _accessToken

    fun set(token: String?) { _accessToken.value = token }
    fun get(): String? = _accessToken.value
}

/** Attaches `Authorization: Bearer`, `Idempotency-Key` (state-changing only), and `x-request-id`. */
class AuthInterceptor : Interceptor {
    override fun intercept(chain: Interceptor.Chain): okhttp3.Response {
        val req = chain.request()
        val method = req.method
        val isStateChanging = method != "GET" && method != "HEAD"
        val builder = req.newBuilder()
        val token = SessionHolder.get()
        if (token != null) builder.header("Authorization", "Bearer $token")
        if (isStateChanging && req.header("Idempotency-Key") == null) {
            builder.header("Idempotency-Key", UUID.randomUUID().toString())
        }
        if (req.header("x-request-id") == null) {
            builder.header("x-request-id", UUID.randomUUID().toString())
        }
        if (method == "GET") builder.header("Accept", "application/json")
        return chain.proceed(builder.build())
    }
}

fun createOkHttpClient(): OkHttpClient {
    val logging = HttpLoggingInterceptor().apply {
        level = if (BuildConfig.DEBUG) HttpLoggingInterceptor.Level.BODY else HttpLoggingInterceptor.Level.NONE
    }
    return OkHttpClient.Builder()
        .addInterceptor(AuthInterceptor())
        .addInterceptor(logging)
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(10, TimeUnit.SECONDS)
        .writeTimeout(10, TimeUnit.SECONDS)
        .retryOnConnectionFailure(true)
        .build()
}

val appJson = Json { ignoreUnknownKeys = true; encodeDefaults = true }
