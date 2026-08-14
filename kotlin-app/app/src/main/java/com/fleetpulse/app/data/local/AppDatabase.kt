package com.fleetpulse.app.data.local

import android.content.Context
import androidx.room.Dao
import androidx.room.Database
import androidx.room.Entity
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.PrimaryKey
import androidx.room.Query
import androidx.room.Room
import androidx.room.RoomDatabase
import java.util.UUID

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
    val status: String,
    val lastErrorCode: String?,
    val lastErrorMessage: String?,
)

@Entity(tableName = "form_drafts")
data class RoomFormDraft(
    @PrimaryKey val formType: String,
    val lastUpdated: Long,
    val draftJson: String,
)

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

@Dao
interface DraftDao {
    @Query("SELECT * FROM form_drafts WHERE formType = :formType")
    suspend fun get(formType: String): RoomFormDraft?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun save(draft: RoomFormDraft)

    @Query("DELETE FROM form_drafts WHERE formType = :formType")
    suspend fun delete(formType: String)
}

@Database(
    entities = [
        RoomQueueItem::class,
        RoomFormDraft::class
    ],
    version = 1,
    exportSchema = false
)
abstract class AppDatabase : RoomDatabase() {
    abstract fun queueDao(): QueueDao
    abstract fun draftDao(): DraftDao

    companion object {
        @Volatile private var INSTANCE: AppDatabase? = null
        fun get(context: Context): AppDatabase =
            INSTANCE ?: synchronized(this) {
                INSTANCE ?: Room.databaseBuilder(
                    context.applicationContext, AppDatabase::class.java, "fleet_pulse_db",
                ).fallbackToDestructiveMigration(true).build().also { INSTANCE = it }

            }
    }
}

fun newQueueId(): String = "q_" + UUID.randomUUID().toString()
fun newIdempotencyKey(): String = UUID.randomUUID().toString()
