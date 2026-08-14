package com.fleetpulse.app.data.local

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query

@Dao
interface DraftDao {
    @Query("SELECT * FROM form_drafts WHERE formType = :formType")
    suspend fun get(formType: String): RoomFormDraft?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun save(draft: RoomFormDraft)

    @Query("DELETE FROM form_drafts WHERE formType = :formType")
    suspend fun delete(formType: String)
}
