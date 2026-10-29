-- DWS-only: this executable artifact is hard-coded to the dwp application schema.
-- Use only when the final effective Profile schema is dwp and this session reports current_schema() = 'dwp'.
-- The schema guard aborts before locking or modifying persistent application tables on a mismatch.
-- Do not use this script for non-dwp Profiles; it is not a schema-portable template.
-- Replace __SNAPSHOT_ID__ with an existing snapshot_id before execution.
-- The snapshot guard prevents an unknown or unchanged placeholder from disabling the active graph.

BEGIN;

CREATE TEMP TABLE tmp_lineage_rollback_schema_guard (
    validation_passed SMALLINT NOT NULL
) ON COMMIT DROP;

INSERT INTO tmp_lineage_rollback_schema_guard (validation_passed)
SELECT CASE WHEN current_schema() = 'dwp' THEN 1 ELSE NULL END;

LOCK TABLE dwp.p_lineage_snapshot IN EXCLUSIVE MODE;

CREATE TEMP TABLE tmp_lineage_rollback_target ON COMMIT DROP AS
SELECT '__SNAPSHOT_ID__' AS snapshot_id;

CREATE TEMP TABLE tmp_lineage_rollback_guard (
    validation_passed SMALLINT NOT NULL
) ON COMMIT DROP;

INSERT INTO tmp_lineage_rollback_guard (validation_passed)
SELECT CASE WHEN count(*) = 0 THEN 1 ELSE NULL END
FROM tmp_lineage_rollback_target target
WHERE NOT EXISTS (
       SELECT 1
       FROM dwp.p_lineage_snapshot snapshot
       WHERE snapshot.snapshot_id = target.snapshot_id
   );

UPDATE dwp.p_lineage_snapshot
SET status_code = 'INACTIVE'
WHERE status_code = 'ACTIVE';

UPDATE dwp.p_lineage_snapshot
SET status_code = 'ACTIVE'
WHERE snapshot_id = (SELECT snapshot_id FROM tmp_lineage_rollback_target);

COMMIT;

SELECT snapshot_id, generated_at, generator_name, import_batch_id, status_code
FROM dwp.p_lineage_snapshot
WHERE status_code = 'ACTIVE';
