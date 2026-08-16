ALTER TABLE dwp.p_push_system
    ADD COLUMN importance_level_code VARCHAR(16) NOT NULL DEFAULT 'normal';

ALTER TABLE dwp.p_push_system
    ADD COLUMN latest_output_time VARCHAR(5);

COMMENT ON COLUMN dwp.p_push_system.importance_level_code IS '重要程度，normal/important';
COMMENT ON COLUMN dwp.p_push_system.latest_output_time IS '最晚出数时间，HH:mm 24 小时制';
