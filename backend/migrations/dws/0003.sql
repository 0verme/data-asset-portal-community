ALTER TABLE dwp.p_api_asset ADD COLUMN IF NOT EXISTS system_id BIGINT;
UPDATE dwp.p_api_asset SET system_id = downstream_system_id WHERE system_id IS NULL;
