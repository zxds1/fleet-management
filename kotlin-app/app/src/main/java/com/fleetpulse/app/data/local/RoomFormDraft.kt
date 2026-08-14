package com.fleetpulse.app.data.local

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "form_drafts")
data class RoomFormDraft(
    @PrimaryKey val formType: String, // CLOCK_IN / REFUEL / DVIR / ACCIDENT / TRAILER_SWAP
    val lastUpdated: Long,
    val draftJson: String,
)
