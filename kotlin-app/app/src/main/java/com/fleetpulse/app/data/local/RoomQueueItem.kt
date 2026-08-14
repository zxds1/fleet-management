package com.fleetpulse.app.data.local

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "offline_queue")
data class RoomQueueItem(
    @PrimaryKey val id: String,
    val idempotencyKey: String,
    val payloadType: String,
    val method: String,
    val path: String,
    val summary: String,
    val bodyJson: String,
    val timestamp: Long,
    val attempts: Int,
    val status: String, // PENDING / INFLIGHT / DONE / FAILED_REVIEW / DISCARDED
    val lastErrorCode: String?,
    val lastErrorMessage: String?,
)
