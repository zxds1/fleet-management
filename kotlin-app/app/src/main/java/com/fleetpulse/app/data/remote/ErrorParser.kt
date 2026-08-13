package com.fleetpulse.app.data.remote

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.ResponseBody

/**
 * Parses an `application/problem+json` body (packages/shared/src/errors.ts) into an [AppException].
 * The app branches ONLY on `error_code`. Falls back to a status-derived code when absent.
 */
object ErrorParser {
    private val json = Json { ignoreUnknownKeys = true }

    fun parse(statusCode: Int, body: String?, requestId: String?): AppException {
        if (body.isNullOrBlank()) return AppException(
            errorCode = codeForStatus(statusCode),
            status = statusCode,
            requestId = requestId,
            bucket = if (statusCode >= 500) ErrorBucket.TRANSIENT else ErrorBucket.CLIENT,
        )
        return try {
            val root = json.parseToJsonElement(body).jsonObject
            val errorCode = root["error_code"]?.jsonPrimitive?.content ?: codeForStatus(statusCode)
            val detail = root["detail"]?.jsonPrimitive?.content
            val title = root["title"]?.jsonPrimitive?.content
            val fieldErrors = parseFieldErrors(root)
            AppException.fromErrorCode(errorCode, detail ?: title).copy(
                title = title,
                status = statusCode,
                requestId = requestId,
                fieldErrors = fieldErrors,
            )
        } catch (_: Exception) {
            AppException(errorCode = codeForStatus(statusCode), status = statusCode, requestId = requestId)
        }
    }

    private fun parseFieldErrors(root: kotlinx.serialization.json.JsonObject): List<FieldError> {
        val arr = root["field_errors"] ?: return emptyList()
        return try {
            arr.jsonArray.mapNotNull { e ->
                val o = e.jsonObject
                FieldError(
                    field = o["field"]?.jsonPrimitive?.content ?: "",
                    code = o["code"]?.jsonPrimitive?.content ?: "",
                    message = o["message"]?.jsonPrimitive?.content ?: "",
                )
            }
        } catch (_: Exception) { emptyList() }
    }

    fun codeForStatus(status: Int): String = when (status) {
        401 -> "UNAUTHENTICATED"
        403 -> "FORBIDDEN"
        404 -> "NOT_FOUND"
        409 -> "CONFLICT"
        422 -> "VALIDATION_ERROR"
        429 -> "RATE_LIMITED"
        in 500..599 -> "SERVICE_UNAVAILABLE"
        else -> "UNKNOWN"
    }
}

fun ResponseBody?.stringOrNull(): String? = try {
    this?.string()
} catch (_: Exception) { null }
