CREATE SCHEMA IF NOT EXISTS dwp;
CREATE TABLE IF NOT EXISTS dwp.p_system (
    system_id BIGINT PRIMARY KEY, system_code VARCHAR(64) NOT NULL UNIQUE,
    system_name VARCHAR(256) NOT NULL, system_abbr VARCHAR(32) NOT NULL DEFAULT '',
    description_text VARCHAR(2000), system_type VARCHAR(64) NOT NULL DEFAULT 'business',
    department_name VARCHAR(128), status_code VARCHAR(32) NOT NULL DEFAULT 'enabled',
    is_deleted CHAR(1) NOT NULL DEFAULT 'N', created_by VARCHAR(64) NOT NULL DEFAULT 'system',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_by VARCHAR(64) NOT NULL DEFAULT 'system',
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS dwp.p_data_source (
    source_id BIGINT PRIMARY KEY, source_code VARCHAR(64) NOT NULL UNIQUE,
    source_name VARCHAR(256) NOT NULL, source_type VARCHAR(64) NOT NULL,
    description_text VARCHAR(2000), status_code VARCHAR(32) NOT NULL DEFAULT 'enabled',
    is_deleted CHAR(1) NOT NULL DEFAULT 'N', created_by VARCHAR(64) NOT NULL DEFAULT 'system',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_by VARCHAR(64) NOT NULL DEFAULT 'system',
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
DO $$
BEGIN
  IF to_regclass('dwp.p_push_system') IS NOT NULL THEN
    ALTER TABLE dwp.p_push_system ADD COLUMN IF NOT EXISTS master_system_id BIGINT;
    INSERT INTO dwp.p_system (
      system_id,system_code,system_name,system_abbr,description_text,system_type,
      department_name,status_code,is_deleted,created_by,created_at,updated_by,updated_at
    )
    SELECT system_id,system_code,system_name,system_abbr,system_desc,'downstream',
           dept_name,status_code,is_deleted,created_by,created_at,updated_by,updated_at
    FROM dwp.p_push_system
    ON CONFLICT (system_code) DO NOTHING;
    UPDATE dwp.p_push_system p
       SET master_system_id = s.system_id
      FROM dwp.p_system s
     WHERE p.master_system_id IS NULL AND p.system_code = s.system_code;
  END IF;
  IF to_regclass('dwp.p_upstream_system') IS NOT NULL THEN
    ALTER TABLE dwp.p_upstream_system ADD COLUMN IF NOT EXISTS data_source_id BIGINT;
    INSERT INTO dwp.p_data_source (
      source_id,source_code,source_name,source_type,description_text,status_code,
      is_deleted,created_by,created_at,updated_by,updated_at
    )
    SELECT system_pk,system_id,system_name,db_type,system_desc,status_code,
           is_deleted,created_by,created_at,updated_by,updated_at
    FROM dwp.p_upstream_system
    ON CONFLICT (source_code) DO NOTHING;
    UPDATE dwp.p_upstream_system u
       SET data_source_id = s.source_id
      FROM dwp.p_data_source s
     WHERE u.data_source_id IS NULL AND u.system_id = s.source_code;
  END IF;
END $$;
