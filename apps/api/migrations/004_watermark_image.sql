-- Add image_url column for Image Logo Watermark presets
ALTER TABLE watermark_presets ADD COLUMN IF NOT EXISTS image_url TEXT NOT NULL DEFAULT '';
