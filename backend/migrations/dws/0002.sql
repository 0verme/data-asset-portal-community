CREATE TABLE IF NOT EXISTS dwp.p_system (
    system_id BIGINT NOT NULL PRIMARY KEY, system_code VARCHAR(64) NOT NULL,
    system_name VARCHAR(256) NOT NULL, system_abbr VARCHAR(32) NOT NULL,
    description_text VARCHAR(2000), system_type VARCHAR(64) NOT NULL DEFAULT 'business',
    department_name VARCHAR(128), status_code VARCHAR(32) NOT NULL DEFAULT 'enabled',
    is_deleted CHAR(1) NOT NULL DEFAULT 'N', created_by VARCHAR(64) NOT NULL DEFAULT 'system',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_by VARCHAR(64) NOT NULL DEFAULT 'system',
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(system_code)
);
CREATE TABLE IF NOT EXISTS dwp.p_data_source (
    source_id BIGINT NOT NULL PRIMARY KEY, source_code VARCHAR(64) NOT NULL,
    source_name VARCHAR(256) NOT NULL, source_type VARCHAR(64) NOT NULL,
    description_text VARCHAR(2000), status_code VARCHAR(32) NOT NULL DEFAULT 'enabled',
    is_deleted CHAR(1) NOT NULL DEFAULT 'N', created_by VARCHAR(64) NOT NULL DEFAULT 'system',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_by VARCHAR(64) NOT NULL DEFAULT 'system',
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(source_code)
);
ALTER TABLE dwp.p_push_system ADD COLUMN IF NOT EXISTS master_system_id BIGINT;
ALTER TABLE dwp.p_upstream_system ADD COLUMN IF NOT EXISTS data_source_id BIGINT;
INSERT INTO dwp.p_system (
  system_id,system_code,system_name,system_abbr,description_text,system_type,
  department_name,status_code,is_deleted,created_by,created_at,updated_by,updated_at
)
SELECT p.system_id,p.system_code,p.system_name,p.system_abbr,p.system_desc,'downstream',
       p.dept_name,p.status_code,p.is_deleted,p.created_by,p.created_at,p.updated_by,p.updated_at
FROM dwp.p_push_system p
WHERE NOT EXISTS (
  SELECT 1 FROM dwp.p_system s WHERE s.system_code = p.system_code
);
UPDATE dwp.p_push_system p
SET master_system_id = s.system_id
FROM dwp.p_system s
WHERE p.master_system_id IS NULL AND p.system_code = s.system_code;
INSERT INTO dwp.p_data_source (
  source_id,source_code,source_name,source_type,description_text,status_code,
  is_deleted,created_by,created_at,updated_by,updated_at
)
SELECT u.system_pk,u.system_id,u.system_name,u.db_type,u.system_desc,u.status_code,
       u.is_deleted,u.created_by,u.created_at,u.updated_by,u.updated_at
FROM dwp.p_upstream_system u
WHERE NOT EXISTS (
  SELECT 1 FROM dwp.p_data_source s WHERE s.source_code = u.system_id
);
UPDATE dwp.p_upstream_system u
SET data_source_id = s.source_id
FROM dwp.p_data_source s
WHERE u.data_source_id IS NULL AND u.system_id = s.source_code;
