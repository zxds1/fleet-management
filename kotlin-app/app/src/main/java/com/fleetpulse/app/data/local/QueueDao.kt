package com.fleetpulse.app.data.local

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query

@Dao
interface QueueDao {
    @Query("SELECT * FROM offline_queue ORDER BY timestamp ASC")
    suspend fun getAll(): List<RoomQueueItem>

    @Query("SELECT * FROM offline_queue WHERE status IN ('PENDING','INFLIGHT','FAILED_REVIEW') ORDER BY timestamp ASC")
    suspend fun getPending(): List<RoomQueueItem>

    @Query("SELECT * FROM offline_queue WHERE status = 'PENDING' ORDER BY timestamp ASC LIMIT 1")
    suspend fun nextPending(): RoomQueueItem?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(item: RoomQueueItem)

    @Query("UPDATE offline_queue SET status = :status, attempts = :attempts, lastErrorCode = :code, lastErrorMessage = :msg WHERE id = :id")
    suspend fun updateStatus(id: String, status: String, attempts: Int, code: String?, msg: String?)

    @Query("DELETE FROM offline_queue WHERE id = :id")
    suspend fun delete(id: String)

    @Query("DELETE FROM offline_queue WHERE status = 'DONE'")
    suspend fun pruneDone()

    @Query("DELETE FROM offline_queue")
    suspend fun clearAll()
}
