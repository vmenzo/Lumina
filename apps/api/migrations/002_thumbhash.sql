-- Add ThumbHash (25-byte base64) support to storage_objects for zero-CLS progressive rendering
ALTER TABLE storage_objects ADD COLUMN IF NOT EXISTS thumbhash TEXT NOT NULL DEFAULT '';
