-- A1.4 v2: require the pump photograph in place of the odometer gauge photo.
-- Refuel submissions now carry the receipt + pump-photo pair (the pump reading
-- is OCR'd for litres / amount / date / station). The odometer gauge photo is
-- retired as an optional legacy field.
ALTER TABLE app.fuel_purchases
    ADD COLUMN IF NOT EXISTS pump_photo_media_object_id uuid REFERENCES app.media_objects(id);

ALTER TABLE app.fuel_purchases
    DROP CONSTRAINT IF EXISTS fuel_purchases_photo_entry_has_photos;
ALTER TABLE app.fuel_purchases
    ADD CONSTRAINT fuel_purchases_photo_entry_has_photos
        CHECK (entry_source <> 'DRIVER_PHOTO'
               OR (receipt_media_object_id IS NOT NULL
                   AND pump_photo_media_object_id IS NOT NULL
                   AND driver_id IS NOT NULL))
        NOT VALID;
ALTER TABLE app.fuel_purchases
    VALIDATE CONSTRAINT fuel_purchases_photo_entry_has_photos;

CREATE INDEX IF NOT EXISTS fuel_purchases_pump_photo_idx
    ON app.fuel_purchases (pump_photo_media_object_id)
    WHERE pump_photo_media_object_id IS NOT NULL;

COMMENT ON COLUMN app.fuel_purchases.pump_photo_media_object_id IS
    'A1.4 photo-first capture v2. Pump photograph submitted alongside the receipt; OCR reads litres, amount, date and station from it.';
COMMENT ON COLUMN app.fuel_purchases.odometer_photo_media_object_id IS
    'Legacy odometer gauge photograph. Retained for historical rows; no longer required for DRIVER_PHOTO entries.';
