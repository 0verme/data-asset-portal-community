-- data-asset-portal
-- DWS / GaussDB database healthcheck
--
-- Usage:
--   1. If your schema is not DWP, change the single schema_name value below.
--   2. Run with gsql:
--      gsql -d <db> -f docs/dws/app-dws-healthcheck.sql
--   3. Read result sets in order:
--      - migration_fingerprint: which upgrade signatures are missing
--      - table_checklist: which tables are missing
--      - column_checklist: which columns/types/lengths are missing or drifted
--      - index_constraint_checklist: key unique indexes / PK / FK
--
-- This script is read-only.

WITH params AS (
    SELECT UPPER('dwp') AS schema_name
),
expected_tables AS (
    SELECT * FROM (
        VALUES
            ('P_ADMIN_USER'),
            ('P_ASSET_CHANGE_LOG'),
            ('P_ASSET_DOMAIN'),
            ('P_ASSET_FIELD'),
            ('P_ASSET_LAYER'),
            ('P_ASSET_TABLE'),
            ('P_CODE_CATEGORY'),
            ('P_CODE_ITEM'),
            ('P_FIELD_MAPPING_CHANGE_LOG'),
            ('P_FIELD_MAPPING_FIELD'),
            ('P_FIELD_MAPPING_TABLE'),
            ('P_INDICATOR_CHANGE_LOG'),
            ('P_INDICATOR_ITEM'),
            ('P_INDICATOR_PATH_CONFIG'),
            ('P_MENU'),
            ('P_OPERATION_LOG'),
            ('P_PUSH_CHANGE_LOG'),
            ('P_PUSH_JOB'),
            ('P_PUSH_JOB_FIELD'),
            ('P_PUSH_SYSTEM'),
            ('P_REPORT_ASSET'),
            ('P_ROOT_CATEGORY'),
            ('P_ROOT_CHANGE_LOG'),
            ('P_ROOT_ITEM'),
            ('P_UPSTREAM_CHANGE_LOG'),
            ('P_UPSTREAM_SYSTEM'),
            ('P_UPSTREAM_UNLOAD_TIME')
    ) AS t(table_name)
),
actual_tables AS (
    SELECT UPPER(table_name) AS table_name
    FROM information_schema.tables
    WHERE UPPER(table_schema) = (SELECT schema_name FROM params)
)
SELECT *
FROM (
    SELECT
        10 AS sort_order,
        'baseline_expected_tables' AS check_item,
        CASE
            WHEN (SELECT COUNT(*) FROM actual_tables a JOIN expected_tables e ON a.table_name = e.table_name)
                 = (SELECT COUNT(*) FROM expected_tables)
            THEN 'OK'
            ELSE 'MISSING'
        END AS status,
        CAST((SELECT COUNT(*) FROM expected_tables) AS VARCHAR(20)) AS expected,
        CAST((SELECT COUNT(*) FROM actual_tables a JOIN expected_tables e ON a.table_name = e.table_name) AS VARCHAR(20)) AS actual,
        '基线 DDL 是否完整落库' AS note

    UNION ALL

    SELECT
        20,
        '20260623_indicator_path_config',
        CASE WHEN EXISTS (SELECT 1 FROM actual_tables WHERE table_name = 'P_INDICATOR_PATH_CONFIG') THEN 'OK' ELSE 'MISSING' END,
        'table P_INDICATOR_PATH_CONFIG exists',
        CASE WHEN EXISTS (SELECT 1 FROM actual_tables WHERE table_name = 'P_INDICATOR_PATH_CONFIG') THEN 'exists' ELSE 'missing' END,
        '缺失说明 2026-06-23 指标路径配置升级未生效'

    UNION ALL

    SELECT
        30,
        '20260624_indicator_result_columns',
        CASE
            WHEN (
                SELECT COUNT(*)
                FROM information_schema.columns
                WHERE UPPER(table_schema) = (SELECT schema_name FROM params)
                  AND UPPER(table_name) = 'P_INDICATOR_ITEM'
                  AND UPPER(column_name) IN ('RESULT_TABLE_NAME', 'RESULT_FIELD_NAME')
            ) = 2
            THEN 'OK'
            ELSE 'MISSING'
        END,
        'P_INDICATOR_ITEM.RESULT_TABLE_NAME + RESULT_FIELD_NAME',
        CAST((
            SELECT COUNT(*)
            FROM information_schema.columns
            WHERE UPPER(table_schema) = (SELECT schema_name FROM params)
              AND UPPER(table_name) = 'P_INDICATOR_ITEM'
              AND UPPER(column_name) IN ('RESULT_TABLE_NAME', 'RESULT_FIELD_NAME')
        ) AS VARCHAR(20)),
        '缺失说明 2026-06-24 指标结果字段升级未生效'

    UNION ALL

    SELECT
        40,
        '20260623_push_job_split_source_target',
        CASE
            WHEN (
                SELECT COUNT(*)
                FROM information_schema.columns
                WHERE UPPER(table_schema) = (SELECT schema_name FROM params)
                  AND UPPER(table_name) = 'P_PUSH_JOB'
                  AND UPPER(column_name) IN ('SOURCE_PATH', 'SOURCE_FILE_NAME', 'TARGET_PATH', 'TARGET_FILE_NAME')
            ) = 4
             AND (
                SELECT COUNT(*)
                FROM information_schema.columns
                WHERE UPPER(table_schema) = (SELECT schema_name FROM params)
                  AND UPPER(table_name) = 'P_PUSH_JOB'
                  AND UPPER(column_name) IN ('LAKE_PATH', 'FILE_NAME_PATTERN')
            ) = 0
            THEN 'OK'
            ELSE 'DRIFT'
        END,
        'new cols exist and old cols removed',
        'new_cols=' ||
        CAST((
            SELECT COUNT(*)
            FROM information_schema.columns
            WHERE UPPER(table_schema) = (SELECT schema_name FROM params)
              AND UPPER(table_name) = 'P_PUSH_JOB'
              AND UPPER(column_name) IN ('SOURCE_PATH', 'SOURCE_FILE_NAME', 'TARGET_PATH', 'TARGET_FILE_NAME')
        ) AS VARCHAR(20)) ||
        ', old_cols=' ||
        CAST((
            SELECT COUNT(*)
            FROM information_schema.columns
            WHERE UPPER(table_schema) = (SELECT schema_name FROM params)
              AND UPPER(table_name) = 'P_PUSH_JOB'
              AND UPPER(column_name) IN ('LAKE_PATH', 'FILE_NAME_PATTERN')
        ) AS VARCHAR(20)),
        '异常说明 2026-06-23 推送作业字段拆分升级未完全生效'

    UNION ALL

    SELECT
        50,
        '20260628_field_mapping_upstream_fk',
        CASE
            WHEN (
                SELECT COUNT(*)
                FROM information_schema.columns
                WHERE UPPER(table_schema) = (SELECT schema_name FROM params)
                  AND UPPER(table_name) = 'P_FIELD_MAPPING_TABLE'
                  AND UPPER(column_name) = 'UPSTREAM_SYSTEM_ID'
            ) = 1
             AND (
                SELECT COUNT(*)
                FROM information_schema.columns
                WHERE UPPER(table_schema) = (SELECT schema_name FROM params)
                  AND UPPER(table_name) = 'P_FIELD_MAPPING_TABLE'
                  AND UPPER(column_name) = 'SYSTEM_PK'
            ) = 0
             AND NOT EXISTS (SELECT 1 FROM actual_tables WHERE table_name = 'P_FIELD_MAPPING_SYSTEM')
             AND (
                SELECT COUNT(*)
                FROM information_schema.table_constraints tc
                JOIN information_schema.key_column_usage kcu
                  ON tc.constraint_name = kcu.constraint_name
                 AND tc.table_schema = kcu.table_schema
                 AND tc.table_name = kcu.table_name
                WHERE UPPER(tc.table_schema) = (SELECT schema_name FROM params)
                  AND UPPER(tc.table_name) = 'P_FIELD_MAPPING_TABLE'
                  AND tc.constraint_type = 'FOREIGN KEY'
                  AND UPPER(kcu.column_name) = 'UPSTREAM_SYSTEM_ID'
            ) >= 1
            THEN 'OK'
            ELSE 'DRIFT'
        END,
        'UPSTREAM_SYSTEM_ID present, SYSTEM_PK removed, P_FIELD_MAPPING_SYSTEM removed, FK exists',
        'new_col=' ||
        CAST((
            SELECT COUNT(*)
            FROM information_schema.columns
            WHERE UPPER(table_schema) = (SELECT schema_name FROM params)
              AND UPPER(table_name) = 'P_FIELD_MAPPING_TABLE'
              AND UPPER(column_name) = 'UPSTREAM_SYSTEM_ID'
        ) AS VARCHAR(20)) ||
        ', old_col=' ||
        CAST((
            SELECT COUNT(*)
            FROM information_schema.columns
            WHERE UPPER(table_schema) = (SELECT schema_name FROM params)
              AND UPPER(table_name) = 'P_FIELD_MAPPING_TABLE'
              AND UPPER(column_name) = 'SYSTEM_PK'
        ) AS VARCHAR(20)) ||
        ', legacy_table=' ||
        CASE WHEN EXISTS (SELECT 1 FROM actual_tables WHERE table_name = 'P_FIELD_MAPPING_SYSTEM') THEN 'exists' ELSE 'missing' END,
        '异常说明 2026-06-28 字段映射上游系统外键升级未完全生效'
) t
ORDER BY sort_order;


WITH params AS (
    SELECT UPPER('dwp') AS schema_name
),
expected_tables AS (
    SELECT * FROM (
        VALUES
            ('P_ADMIN_USER'),
            ('P_ASSET_CHANGE_LOG'),
            ('P_ASSET_DOMAIN'),
            ('P_ASSET_FIELD'),
            ('P_ASSET_LAYER'),
            ('P_ASSET_TABLE'),
            ('P_CODE_CATEGORY'),
            ('P_CODE_ITEM'),
            ('P_FIELD_MAPPING_CHANGE_LOG'),
            ('P_FIELD_MAPPING_FIELD'),
            ('P_FIELD_MAPPING_TABLE'),
            ('P_INDICATOR_CHANGE_LOG'),
            ('P_INDICATOR_ITEM'),
            ('P_INDICATOR_PATH_CONFIG'),
            ('P_MENU'),
            ('P_OPERATION_LOG'),
            ('P_PUSH_CHANGE_LOG'),
            ('P_PUSH_JOB'),
            ('P_PUSH_JOB_FIELD'),
            ('P_PUSH_SYSTEM'),
            ('P_REPORT_ASSET'),
            ('P_ROOT_CATEGORY'),
            ('P_ROOT_CHANGE_LOG'),
            ('P_ROOT_ITEM'),
            ('P_UPSTREAM_CHANGE_LOG'),
            ('P_UPSTREAM_SYSTEM'),
            ('P_UPSTREAM_UNLOAD_TIME')
    ) AS t(table_name)
),
actual_tables AS (
    SELECT UPPER(table_name) AS table_name
    FROM information_schema.tables
    WHERE UPPER(table_schema) = (SELECT schema_name FROM params)
)
SELECT
    'table_checklist' AS report_name,
    e.table_name,
    CASE WHEN a.table_name IS NULL THEN 'MISSING' ELSE 'OK' END AS status
FROM expected_tables e
LEFT JOIN actual_tables a
  ON a.table_name = e.table_name
ORDER BY e.table_name;


WITH params AS (
    SELECT UPPER('dwp') AS schema_name
),
expected_columns AS (
    SELECT * FROM (
        VALUES
            ('P_ADMIN_USER', 'ID', 'bigint', NULL),
            ('P_ADMIN_USER', 'USERNAME', 'character varying', 64),
            ('P_ADMIN_USER', 'PASSWORD_HASH', 'character varying', 512),
            ('P_ADMIN_USER', 'DISPLAY_NAME', 'character varying', 128),
            ('P_ADMIN_USER', 'STATUS', 'character varying', 16),
            ('P_ADMIN_USER', 'LAST_LOGIN_AT', 'timestamp without time zone', NULL),
            ('P_ADMIN_USER', 'CREATED_AT', 'timestamp without time zone', NULL),
            ('P_ADMIN_USER', 'UPDATED_AT', 'timestamp without time zone', NULL),

            ('P_ASSET_CHANGE_LOG', 'CHANGE_ID', 'bigint', NULL),
            ('P_ASSET_CHANGE_LOG', 'ASSET_ID', 'bigint', NULL),
            ('P_ASSET_CHANGE_LOG', 'TABLE_NAME', 'character varying', 128),
            ('P_ASSET_CHANGE_LOG', 'CHANGE_TYPE', 'character varying', 32),
            ('P_ASSET_CHANGE_LOG', 'CHANGE_SUMMARY', 'character varying', 1000),
            ('P_ASSET_CHANGE_LOG', 'BEFORE_JSON', 'text', NULL),
            ('P_ASSET_CHANGE_LOG', 'AFTER_JSON', 'text', NULL),
            ('P_ASSET_CHANGE_LOG', 'OPERATOR_NAME', 'character varying', 64),
            ('P_ASSET_CHANGE_LOG', 'CHANGE_TIME', 'timestamp without time zone', NULL),
            ('P_ASSET_CHANGE_LOG', 'TRACE_ID', 'character varying', 128),

            ('P_ASSET_DOMAIN', 'DOMAIN_ID', 'bigint', NULL),
            ('P_ASSET_DOMAIN', 'DOMAIN_CODE', 'character varying', 64),
            ('P_ASSET_DOMAIN', 'DOMAIN_NAME', 'character varying', 128),
            ('P_ASSET_DOMAIN', 'DISPLAY_ORDER', 'integer', NULL),
            ('P_ASSET_DOMAIN', 'IS_ACTIVE', 'character', 1),
            ('P_ASSET_DOMAIN', 'REMARK', 'character varying', 500),
            ('P_ASSET_DOMAIN', 'CREATED_AT', 'timestamp without time zone', NULL),
            ('P_ASSET_DOMAIN', 'UPDATED_AT', 'timestamp without time zone', NULL),

            ('P_ASSET_FIELD', 'FIELD_ID', 'bigint', NULL),
            ('P_ASSET_FIELD', 'ASSET_ID', 'bigint', NULL),
            ('P_ASSET_FIELD', 'FIELD_NAME', 'character varying', 128),
            ('P_ASSET_FIELD', 'FIELD_CN_NAME', 'character varying', 256),
            ('P_ASSET_FIELD', 'DATA_TYPE', 'character varying', 128),
            ('P_ASSET_FIELD', 'FIELD_ORDER', 'integer', NULL),
            ('P_ASSET_FIELD', 'NULLABLE_FLAG', 'character', 1),
            ('P_ASSET_FIELD', 'PK_FLAG', 'character', 1),
            ('P_ASSET_FIELD', 'PARTITION_FLAG', 'character', 1),
            ('P_ASSET_FIELD', 'ENUM_DESC', 'character varying', 2000),
            ('P_ASSET_FIELD', 'FIELD_DESC', 'character varying', 2000),
            ('P_ASSET_FIELD', 'IS_DELETED', 'character', 1),
            ('P_ASSET_FIELD', 'CREATED_BY', 'character varying', 64),
            ('P_ASSET_FIELD', 'CREATED_AT', 'timestamp without time zone', NULL),
            ('P_ASSET_FIELD', 'UPDATED_BY', 'character varying', 64),
            ('P_ASSET_FIELD', 'UPDATED_AT', 'timestamp without time zone', NULL),

            ('P_ASSET_LAYER', 'LAYER_ID', 'bigint', NULL),
            ('P_ASSET_LAYER', 'LAYER_CODE', 'character varying', 32),
            ('P_ASSET_LAYER', 'LAYER_NAME', 'character varying', 128),
            ('P_ASSET_LAYER', 'DISPLAY_ORDER', 'integer', NULL),
            ('P_ASSET_LAYER', 'IS_ACTIVE', 'character', 1),
            ('P_ASSET_LAYER', 'REMARK', 'character varying', 500),
            ('P_ASSET_LAYER', 'CREATED_AT', 'timestamp without time zone', NULL),
            ('P_ASSET_LAYER', 'UPDATED_AT', 'timestamp without time zone', NULL),

            ('P_ASSET_TABLE', 'ASSET_ID', 'bigint', NULL),
            ('P_ASSET_TABLE', 'TABLE_NAME', 'character varying', 128),
            ('P_ASSET_TABLE', 'TABLE_CN_NAME', 'character varying', 256),
            ('P_ASSET_TABLE', 'SCHEMA_NAME', 'character varying', 64),
            ('P_ASSET_TABLE', 'LAYER_CODE', 'character varying', 32),
            ('P_ASSET_TABLE', 'DOMAIN_CODE', 'character varying', 64),
            ('P_ASSET_TABLE', 'OWNER_NAME', 'character varying', 128),
            ('P_ASSET_TABLE', 'GRAIN_DESC', 'character varying', 500),
            ('P_ASSET_TABLE', 'CYCLE_DESC', 'character varying', 200),
            ('P_ASSET_TABLE', 'TABLE_DESC', 'character varying', 2000),
            ('P_ASSET_TABLE', 'SOURCE_TYPE', 'character varying', 32),
            ('P_ASSET_TABLE', 'STORAGE_TYPE', 'character varying', 32),
            ('P_ASSET_TABLE', 'STATUS_CODE', 'character varying', 32),
            ('P_ASSET_TABLE', 'FIELD_COUNT', 'integer', NULL),
            ('P_ASSET_TABLE', 'IS_DELETED', 'character', 1),
            ('P_ASSET_TABLE', 'CREATED_BY', 'character varying', 64),
            ('P_ASSET_TABLE', 'CREATED_AT', 'timestamp without time zone', NULL),
            ('P_ASSET_TABLE', 'UPDATED_BY', 'character varying', 64),
            ('P_ASSET_TABLE', 'UPDATED_AT', 'timestamp without time zone', NULL),

            ('P_CODE_CATEGORY', 'CATEGORY_ID', 'bigint', NULL),
            ('P_CODE_CATEGORY', 'CATEGORY_CODE', 'character varying', 64),
            ('P_CODE_CATEGORY', 'CATEGORY_NAME', 'character varying', 128),
            ('P_CODE_CATEGORY', 'CATEGORY_DESC', 'character varying', 512),
            ('P_CODE_CATEGORY', 'DISPLAY_ORDER', 'integer', NULL),
            ('P_CODE_CATEGORY', 'IS_ACTIVE', 'character', 1),
            ('P_CODE_CATEGORY', 'REMARK', 'character varying', 1000),
            ('P_CODE_CATEGORY', 'CREATED_BY', 'character varying', 64),
            ('P_CODE_CATEGORY', 'CREATED_AT', 'timestamp without time zone', NULL),
            ('P_CODE_CATEGORY', 'UPDATED_BY', 'character varying', 64),
            ('P_CODE_CATEGORY', 'UPDATED_AT', 'timestamp without time zone', NULL),

            ('P_CODE_ITEM', 'ITEM_ID', 'bigint', NULL),
            ('P_CODE_ITEM', 'CATEGORY_CODE', 'character varying', 64),
            ('P_CODE_ITEM', 'ITEM_CODE', 'character varying', 64),
            ('P_CODE_ITEM', 'ITEM_NAME', 'character varying', 128),
            ('P_CODE_ITEM', 'ITEM_VALUE', 'character varying', 256),
            ('P_CODE_ITEM', 'ITEM_DESC', 'character varying', 512),
            ('P_CODE_ITEM', 'DISPLAY_ORDER', 'integer', NULL),
            ('P_CODE_ITEM', 'EXT_JSON', 'text', NULL),
            ('P_CODE_ITEM', 'IS_ACTIVE', 'character', 1),
            ('P_CODE_ITEM', 'REMARK', 'character varying', 1000),
            ('P_CODE_ITEM', 'CREATED_BY', 'character varying', 64),
            ('P_CODE_ITEM', 'CREATED_AT', 'timestamp without time zone', NULL),
            ('P_CODE_ITEM', 'UPDATED_BY', 'character varying', 64),
            ('P_CODE_ITEM', 'UPDATED_AT', 'timestamp without time zone', NULL),

            ('P_FIELD_MAPPING_CHANGE_LOG', 'CHANGE_ID', 'bigint', NULL),
            ('P_FIELD_MAPPING_CHANGE_LOG', 'TABLE_PK', 'bigint', NULL),
            ('P_FIELD_MAPPING_CHANGE_LOG', 'FIELD_PK', 'bigint', NULL),
            ('P_FIELD_MAPPING_CHANGE_LOG', 'CHANGE_TYPE', 'character varying', 64),
            ('P_FIELD_MAPPING_CHANGE_LOG', 'CHANGE_SUMMARY', 'character varying', 1000),
            ('P_FIELD_MAPPING_CHANGE_LOG', 'BEFORE_JSON', 'text', NULL),
            ('P_FIELD_MAPPING_CHANGE_LOG', 'AFTER_JSON', 'text', NULL),
            ('P_FIELD_MAPPING_CHANGE_LOG', 'OPERATOR_NAME', 'character varying', 64),
            ('P_FIELD_MAPPING_CHANGE_LOG', 'CHANGE_TIME', 'timestamp without time zone', NULL),
            ('P_FIELD_MAPPING_CHANGE_LOG', 'TRACE_ID', 'character varying', 128),

            ('P_FIELD_MAPPING_FIELD', 'FIELD_PK', 'bigint', NULL),
            ('P_FIELD_MAPPING_FIELD', 'TABLE_PK', 'bigint', NULL),
            ('P_FIELD_MAPPING_FIELD', 'SOURCE_FIELD_NAME', 'character varying', 128),
            ('P_FIELD_MAPPING_FIELD', 'SOURCE_FIELD_TYPE', 'character varying', 128),
            ('P_FIELD_MAPPING_FIELD', 'SOURCE_FIELD_COMMENT', 'character varying', 1000),
            ('P_FIELD_MAPPING_FIELD', 'TARGET_FIELD_NAME', 'character varying', 128),
            ('P_FIELD_MAPPING_FIELD', 'MAPPING_RULE', 'character varying', 64),
            ('P_FIELD_MAPPING_FIELD', 'FIELD_ORDER', 'integer', NULL),
            ('P_FIELD_MAPPING_FIELD', 'IS_DELETED', 'character', 1),
            ('P_FIELD_MAPPING_FIELD', 'CREATED_BY', 'character varying', 64),
            ('P_FIELD_MAPPING_FIELD', 'CREATED_AT', 'timestamp without time zone', NULL),
            ('P_FIELD_MAPPING_FIELD', 'UPDATED_BY', 'character varying', 64),
            ('P_FIELD_MAPPING_FIELD', 'UPDATED_AT', 'timestamp without time zone', NULL),

            ('P_FIELD_MAPPING_TABLE', 'TABLE_PK', 'bigint', NULL),
            ('P_FIELD_MAPPING_TABLE', 'UPSTREAM_SYSTEM_ID', 'bigint', NULL),
            ('P_FIELD_MAPPING_TABLE', 'SOURCE_TABLE_NAME', 'character varying', 128),
            ('P_FIELD_MAPPING_TABLE', 'SOURCE_TABLE_CN', 'character varying', 256),
            ('P_FIELD_MAPPING_TABLE', 'TARGET_LAYER_CODE', 'character varying', 32),
            ('P_FIELD_MAPPING_TABLE', 'TARGET_TABLE_NAME', 'character varying', 128),
            ('P_FIELD_MAPPING_TABLE', 'LOAD_MODE', 'character varying', 32),
            ('P_FIELD_MAPPING_TABLE', 'FIELD_TOTAL_COUNT', 'integer', NULL),
            ('P_FIELD_MAPPING_TABLE', 'MAPPED_FIELD_COUNT', 'integer', NULL),
            ('P_FIELD_MAPPING_TABLE', 'LATEST_MAPPING_TIME', 'timestamp without time zone', NULL),
            ('P_FIELD_MAPPING_TABLE', 'TABLE_DESC', 'character varying', 2000),
            ('P_FIELD_MAPPING_TABLE', 'IS_DELETED', 'character', 1),
            ('P_FIELD_MAPPING_TABLE', 'CREATED_BY', 'character varying', 64),
            ('P_FIELD_MAPPING_TABLE', 'CREATED_AT', 'timestamp without time zone', NULL),
            ('P_FIELD_MAPPING_TABLE', 'UPDATED_BY', 'character varying', 64),
            ('P_FIELD_MAPPING_TABLE', 'UPDATED_AT', 'timestamp without time zone', NULL),

            ('P_INDICATOR_CHANGE_LOG', 'CHANGE_ID', 'bigint', NULL),
            ('P_INDICATOR_CHANGE_LOG', 'INDICATOR_PK', 'bigint', NULL),
            ('P_INDICATOR_CHANGE_LOG', 'INDICATOR_ID', 'character varying', 64),
            ('P_INDICATOR_CHANGE_LOG', 'CHANGE_TYPE', 'character varying', 64),
            ('P_INDICATOR_CHANGE_LOG', 'CHANGE_SUMMARY', 'character varying', 512),
            ('P_INDICATOR_CHANGE_LOG', 'BEFORE_JSON', 'text', NULL),
            ('P_INDICATOR_CHANGE_LOG', 'AFTER_JSON', 'text', NULL),
            ('P_INDICATOR_CHANGE_LOG', 'OPERATOR_NAME', 'character varying', 64),
            ('P_INDICATOR_CHANGE_LOG', 'CHANGE_TIME', 'timestamp without time zone', NULL),

            ('P_INDICATOR_ITEM', 'INDICATOR_PK', 'bigint', NULL),
            ('P_INDICATOR_ITEM', 'INDICATOR_ID', 'character varying', 64),
            ('P_INDICATOR_ITEM', 'INDICATOR_NAME', 'character varying', 256),
            ('P_INDICATOR_ITEM', 'MEANING_DESC', 'character varying', 4000),
            ('P_INDICATOR_ITEM', 'RESULT_TABLE_NAME', 'character varying', 256),
            ('P_INDICATOR_ITEM', 'RESULT_FIELD_NAME', 'character varying', 256),
            ('P_INDICATOR_ITEM', 'DIMENSION_CODE', 'character varying', 16),
            ('P_INDICATOR_ITEM', 'CALIBER_DESC', 'character varying', 1000),
            ('P_INDICATOR_ITEM', 'PATH_DESC', 'character varying', 1000),
            ('P_INDICATOR_ITEM', 'STATUS_CODE', 'character varying', 32),
            ('P_INDICATOR_ITEM', 'REGISTRAR_NAME', 'character varying', 64),
            ('P_INDICATOR_ITEM', 'REGISTERED_DATE', 'character varying', 10),
            ('P_INDICATOR_ITEM', 'IS_DELETED', 'character', 1),
            ('P_INDICATOR_ITEM', 'CREATED_BY', 'character varying', 64),
            ('P_INDICATOR_ITEM', 'CREATED_AT', 'timestamp without time zone', NULL),
            ('P_INDICATOR_ITEM', 'UPDATED_BY', 'character varying', 64),
            ('P_INDICATOR_ITEM', 'UPDATED_AT', 'timestamp without time zone', NULL),

            ('P_INDICATOR_PATH_CONFIG', 'ID', 'bigint', NULL),
            ('P_INDICATOR_PATH_CONFIG', 'PARENT_ID', 'bigint', NULL),
            ('P_INDICATOR_PATH_CONFIG', 'PATH_CODE', 'character varying', 64),
            ('P_INDICATOR_PATH_CONFIG', 'PATH_NAME', 'character varying', 256),
            ('P_INDICATOR_PATH_CONFIG', 'DIMENSION_CODE', 'character varying', 16),
            ('P_INDICATOR_PATH_CONFIG', 'PATH_LEVEL', 'smallint', NULL),
            ('P_INDICATOR_PATH_CONFIG', 'FULL_PATH', 'character varying', 1000),
            ('P_INDICATOR_PATH_CONFIG', 'SORT_ORDER', 'integer', NULL),
            ('P_INDICATOR_PATH_CONFIG', 'STATUS', 'character varying', 32),
            ('P_INDICATOR_PATH_CONFIG', 'REMARK', 'character varying', 1000),
            ('P_INDICATOR_PATH_CONFIG', 'CREATED_AT', 'timestamp without time zone', NULL),
            ('P_INDICATOR_PATH_CONFIG', 'UPDATED_AT', 'timestamp without time zone', NULL),

            ('P_MENU', 'MENU_ID', 'bigint', NULL),
            ('P_MENU', 'MENU_CODE', 'character varying', 64),
            ('P_MENU', 'MENU_NAME', 'character varying', 128),
            ('P_MENU', 'MENU_ICON', 'character varying', 64),
            ('P_MENU', 'MENU_PATH', 'character varying', 256),
            ('P_MENU', 'DISPLAY_ORDER', 'integer', NULL),
            ('P_MENU', 'ADMIN_ONLY', 'character', 1),
            ('P_MENU', 'IS_ACTIVE', 'character', 1),
            ('P_MENU', 'MENU_DESC', 'character varying', 512),
            ('P_MENU', 'REMARK', 'character varying', 1000),
            ('P_MENU', 'CREATED_BY', 'character varying', 64),
            ('P_MENU', 'CREATED_AT', 'timestamp without time zone', NULL),
            ('P_MENU', 'UPDATED_BY', 'character varying', 64),
            ('P_MENU', 'UPDATED_AT', 'timestamp without time zone', NULL),

            ('P_OPERATION_LOG', 'ID', 'bigint', NULL),
            ('P_OPERATION_LOG', 'USER_ID', 'character varying', 64),
            ('P_OPERATION_LOG', 'USER_NAME', 'character varying', 128),
            ('P_OPERATION_LOG', 'DEPT_NAME', 'character varying', 128),
            ('P_OPERATION_LOG', 'MODULE_NAME', 'character varying', 64),
            ('P_OPERATION_LOG', 'OPERATION_TYPE', 'character varying', 32),
            ('P_OPERATION_LOG', 'OPERATION_OBJECT', 'character varying', 512),
            ('P_OPERATION_LOG', 'OPERATION_DESC', 'character varying', 1024),
            ('P_OPERATION_LOG', 'REQUEST_METHOD', 'character varying', 16),
            ('P_OPERATION_LOG', 'REQUEST_URL', 'character varying', 512),
            ('P_OPERATION_LOG', 'REQUEST_PARAMS', 'text', NULL),
            ('P_OPERATION_LOG', 'RESULT_STATUS', 'character varying', 16),
            ('P_OPERATION_LOG', 'ERROR_MESSAGE', 'text', NULL),
            ('P_OPERATION_LOG', 'IP_ADDRESS', 'character varying', 64),
            ('P_OPERATION_LOG', 'USER_AGENT', 'character varying', 512),
            ('P_OPERATION_LOG', 'COST_TIME_MS', 'integer', NULL),
            ('P_OPERATION_LOG', 'REMARK', 'character varying', 512),
            ('P_OPERATION_LOG', 'CREATED_AT', 'timestamp without time zone', NULL),

            ('P_PUSH_CHANGE_LOG', 'CHANGE_ID', 'bigint', NULL),
            ('P_PUSH_CHANGE_LOG', 'SYSTEM_ID', 'bigint', NULL),
            ('P_PUSH_CHANGE_LOG', 'JOB_ID', 'bigint', NULL),
            ('P_PUSH_CHANGE_LOG', 'OBJECT_TYPE', 'character varying', 32),
            ('P_PUSH_CHANGE_LOG', 'OBJECT_CODE', 'character varying', 128),
            ('P_PUSH_CHANGE_LOG', 'CHANGE_TYPE', 'character varying', 64),
            ('P_PUSH_CHANGE_LOG', 'CHANGE_SUMMARY', 'character varying', 1000),
            ('P_PUSH_CHANGE_LOG', 'BEFORE_JSON', 'text', NULL),
            ('P_PUSH_CHANGE_LOG', 'AFTER_JSON', 'text', NULL),
            ('P_PUSH_CHANGE_LOG', 'OPERATOR_NAME', 'character varying', 64),
            ('P_PUSH_CHANGE_LOG', 'CHANGE_TIME', 'timestamp without time zone', NULL),
            ('P_PUSH_CHANGE_LOG', 'TRACE_ID', 'character varying', 128),

            ('P_PUSH_JOB', 'JOB_ID', 'bigint', NULL),
            ('P_PUSH_JOB', 'SYSTEM_ID', 'bigint', NULL),
            ('P_PUSH_JOB', 'JOB_CODE', 'character varying', 128),
            ('P_PUSH_JOB', 'JOB_NAME', 'character varying', 256),
            ('P_PUSH_JOB', 'SOURCE_PATH', 'character varying', 1000),
            ('P_PUSH_JOB', 'SOURCE_FILE_NAME', 'character varying', 512),
            ('P_PUSH_JOB', 'TARGET_PATH', 'character varying', 1000),
            ('P_PUSH_JOB', 'TARGET_FILE_NAME', 'character varying', 512),
            ('P_PUSH_JOB', 'FREQ_DESC', 'character varying', 200),
            ('P_PUSH_JOB', 'FREQ_TYPE', 'character varying', 64),
            ('P_PUSH_JOB', 'DELIMITER_CODE', 'character varying', 32),
            ('P_PUSH_JOB', 'ENCODING_TYPE', 'character varying', 64),
            ('P_PUSH_JOB', 'ROW_COUNT_DESC', 'character varying', 200),
            ('P_PUSH_JOB', 'ENABLED_FLAG', 'character', 1),
            ('P_PUSH_JOB', 'OWNER_NAME', 'character varying', 128),
            ('P_PUSH_JOB', 'JOB_DESC', 'character varying', 2000),
            ('P_PUSH_JOB', 'FIELD_COUNT', 'integer', NULL),
            ('P_PUSH_JOB', 'IS_DELETED', 'character', 1),
            ('P_PUSH_JOB', 'CREATED_BY', 'character varying', 64),
            ('P_PUSH_JOB', 'CREATED_AT', 'timestamp without time zone', NULL),
            ('P_PUSH_JOB', 'UPDATED_BY', 'character varying', 64),
            ('P_PUSH_JOB', 'UPDATED_AT', 'timestamp without time zone', NULL),

            ('P_PUSH_JOB_FIELD', 'FIELD_ID', 'bigint', NULL),
            ('P_PUSH_JOB_FIELD', 'JOB_ID', 'bigint', NULL),
            ('P_PUSH_JOB_FIELD', 'FIELD_NAME', 'character varying', 128),
            ('P_PUSH_JOB_FIELD', 'FIELD_CN_NAME', 'character varying', 256),
            ('P_PUSH_JOB_FIELD', 'FIELD_ORDER', 'integer', NULL),
            ('P_PUSH_JOB_FIELD', 'SOURCE_CODE', 'character varying', 64),
            ('P_PUSH_JOB_FIELD', 'DATA_TYPE', 'character varying', 128),
            ('P_PUSH_JOB_FIELD', 'FIELD_MEANING', 'character varying', 2000),
            ('P_PUSH_JOB_FIELD', 'IS_DELETED', 'character', 1),
            ('P_PUSH_JOB_FIELD', 'CREATED_BY', 'character varying', 64),
            ('P_PUSH_JOB_FIELD', 'CREATED_AT', 'timestamp without time zone', NULL),
            ('P_PUSH_JOB_FIELD', 'UPDATED_BY', 'character varying', 64),
            ('P_PUSH_JOB_FIELD', 'UPDATED_AT', 'timestamp without time zone', NULL),

            ('P_PUSH_SYSTEM', 'SYSTEM_ID', 'bigint', NULL),
            ('P_PUSH_SYSTEM', 'SYSTEM_CODE', 'character varying', 64),
            ('P_PUSH_SYSTEM', 'SYSTEM_NAME', 'character varying', 256),
            ('P_PUSH_SYSTEM', 'SYSTEM_ABBR', 'character varying', 32),
            ('P_PUSH_SYSTEM', 'PROTOCOL_TYPE', 'character varying', 32),
            ('P_PUSH_SYSTEM', 'HOST_NAME', 'character varying', 256),
            ('P_PUSH_SYSTEM', 'PORT_NO', 'integer', NULL),
            ('P_PUSH_SYSTEM', 'ACCOUNT_NAME', 'character varying', 128),
            ('P_PUSH_SYSTEM', 'AUTH_TYPE', 'character varying', 64),
            ('P_PUSH_SYSTEM', 'CONTACT_NAME', 'character varying', 128),
            ('P_PUSH_SYSTEM', 'DATA_DEVELOPER_CONTACT_NAME', 'character varying', 128),
            ('P_PUSH_SYSTEM', 'DEPT_NAME', 'character varying', 128),
            ('P_PUSH_SYSTEM', 'SYSTEM_DESC', 'character varying', 2000),
            ('P_PUSH_SYSTEM', 'STATUS_CODE', 'character varying', 32),
            ('P_PUSH_SYSTEM', 'IMPORTANCE_LEVEL_CODE', 'character varying', 16),
            ('P_PUSH_SYSTEM', 'LATEST_OUTPUT_TIME', 'character varying', 5),
            ('P_PUSH_SYSTEM', 'JOB_COUNT', 'integer', NULL),
            ('P_PUSH_SYSTEM', 'IS_DELETED', 'character', 1),
            ('P_PUSH_SYSTEM', 'CREATED_BY', 'character varying', 64),
            ('P_PUSH_SYSTEM', 'CREATED_AT', 'timestamp without time zone', NULL),
            ('P_PUSH_SYSTEM', 'UPDATED_BY', 'character varying', 64),
            ('P_PUSH_SYSTEM', 'UPDATED_AT', 'timestamp without time zone', NULL),

            ('P_REPORT_ASSET', 'REPORT_PK', 'bigint', NULL),
            ('P_REPORT_ASSET', 'REPORT_CODE', 'character varying', 64),
            ('P_REPORT_ASSET', 'REPORT_NAME', 'character varying', 256),
            ('P_REPORT_ASSET', 'REPORT_ALIAS', 'character varying', 256),
            ('P_REPORT_ASSET', 'REPORT_TYPE', 'character varying', 64),
            ('P_REPORT_ASSET', 'DOMAIN_NAME', 'character varying', 128),
            ('P_REPORT_ASSET', 'FREQ_CODE', 'character varying', 32),
            ('P_REPORT_ASSET', 'STATUS_CODE', 'character varying', 32),
            ('P_REPORT_ASSET', 'EFFECTIVE_DATE', 'character varying', 10),
            ('P_REPORT_ASSET', 'EXPIRE_DATE', 'character varying', 10),
            ('P_REPORT_ASSET', 'PURPOSE_DESC', 'character varying', 2000),
            ('P_REPORT_ASSET', 'STAT_OBJECT_DESC', 'character varying', 1000),
            ('P_REPORT_ASSET', 'STAT_SCOPE_DESC', 'character varying', 1000),
            ('P_REPORT_ASSET', 'TIME_CALIBER_DESC', 'character varying', 1000),
            ('P_REPORT_ASSET', 'FILTER_CONDITION_DESC', 'character varying', 2000),
            ('P_REPORT_ASSET', 'SPECIAL_RULE_DESC', 'character varying', 2000),
            ('P_REPORT_ASSET', 'OWNER_DEPT_NAME', 'character varying', 128),
            ('P_REPORT_ASSET', 'OWNER_NAME', 'character varying', 64),
            ('P_REPORT_ASSET', 'MAINTAINER_NAME', 'character varying', 64),
            ('P_REPORT_ASSET', 'RELATED_TABLES_JSON', 'text', NULL),
            ('P_REPORT_ASSET', 'RELATED_INDICATORS_JSON', 'text', NULL),
            ('P_REPORT_ASSET', 'REMARK_DESC', 'character varying', 2000),
            ('P_REPORT_ASSET', 'IS_DELETED', 'character', 1),
            ('P_REPORT_ASSET', 'CREATED_BY', 'character varying', 64),
            ('P_REPORT_ASSET', 'CREATED_AT', 'timestamp without time zone', NULL),
            ('P_REPORT_ASSET', 'UPDATED_BY', 'character varying', 64),
            ('P_REPORT_ASSET', 'UPDATED_AT', 'timestamp without time zone', NULL),

            ('P_ROOT_CATEGORY', 'CATEGORY_ID', 'bigint', NULL),
            ('P_ROOT_CATEGORY', 'CATEGORY_NAME', 'character varying', 64),
            ('P_ROOT_CATEGORY', 'DISPLAY_ORDER', 'integer', NULL),
            ('P_ROOT_CATEGORY', 'IS_DELETED', 'character', 1),
            ('P_ROOT_CATEGORY', 'CREATED_AT', 'timestamp without time zone', NULL),
            ('P_ROOT_CATEGORY', 'UPDATED_AT', 'timestamp without time zone', NULL),

            ('P_ROOT_CHANGE_LOG', 'CHANGE_ID', 'bigint', NULL),
            ('P_ROOT_CHANGE_LOG', 'ROOT_ID', 'bigint', NULL),
            ('P_ROOT_CHANGE_LOG', 'ROOT_ABBR', 'character varying', 64),
            ('P_ROOT_CHANGE_LOG', 'CHANGE_TYPE', 'character varying', 64),
            ('P_ROOT_CHANGE_LOG', 'CHANGE_SUMMARY', 'character varying', 512),
            ('P_ROOT_CHANGE_LOG', 'BEFORE_JSON', 'text', NULL),
            ('P_ROOT_CHANGE_LOG', 'AFTER_JSON', 'text', NULL),
            ('P_ROOT_CHANGE_LOG', 'OPERATOR_NAME', 'character varying', 64),
            ('P_ROOT_CHANGE_LOG', 'CHANGE_TIME', 'timestamp without time zone', NULL),

            ('P_ROOT_ITEM', 'ROOT_ID', 'bigint', NULL),
            ('P_ROOT_ITEM', 'ROOT_ABBR', 'character varying', 64),
            ('P_ROOT_ITEM', 'ROOT_EN_NAME', 'character varying', 256),
            ('P_ROOT_ITEM', 'ROOT_CN_NAME', 'character varying', 256),
            ('P_ROOT_ITEM', 'CATEGORY_NAME', 'character varying', 64),
            ('P_ROOT_ITEM', 'ROOT_DESC', 'character varying', 2000),
            ('P_ROOT_ITEM', 'IS_DELETED', 'character', 1),
            ('P_ROOT_ITEM', 'CREATED_BY', 'character varying', 64),
            ('P_ROOT_ITEM', 'CREATED_AT', 'timestamp without time zone', NULL),
            ('P_ROOT_ITEM', 'UPDATED_BY', 'character varying', 64),
            ('P_ROOT_ITEM', 'UPDATED_AT', 'timestamp without time zone', NULL),

            ('P_UPSTREAM_CHANGE_LOG', 'CHANGE_ID', 'bigint', NULL),
            ('P_UPSTREAM_CHANGE_LOG', 'SYSTEM_PK', 'bigint', NULL),
            ('P_UPSTREAM_CHANGE_LOG', 'SYSTEM_ID', 'character varying', 64),
            ('P_UPSTREAM_CHANGE_LOG', 'CHANGE_TYPE', 'character varying', 64),
            ('P_UPSTREAM_CHANGE_LOG', 'CHANGE_SUMMARY', 'character varying', 512),
            ('P_UPSTREAM_CHANGE_LOG', 'BEFORE_JSON', 'text', NULL),
            ('P_UPSTREAM_CHANGE_LOG', 'AFTER_JSON', 'text', NULL),
            ('P_UPSTREAM_CHANGE_LOG', 'OPERATOR_NAME', 'character varying', 64),
            ('P_UPSTREAM_CHANGE_LOG', 'CHANGE_TIME', 'timestamp without time zone', NULL),

            ('P_UPSTREAM_SYSTEM', 'SYSTEM_PK', 'bigint', NULL),
            ('P_UPSTREAM_SYSTEM', 'SYSTEM_ID', 'character varying', 64),
            ('P_UPSTREAM_SYSTEM', 'SYSTEM_ABBR', 'character varying', 32),
            ('P_UPSTREAM_SYSTEM', 'SYSTEM_NAME', 'character varying', 256),
            ('P_UPSTREAM_SYSTEM', 'DB_TYPE', 'character varying', 64),
            ('P_UPSTREAM_SYSTEM', 'HOST_NAME', 'character varying', 256),
            ('P_UPSTREAM_SYSTEM', 'DB_NAME', 'character varying', 256),
            ('P_UPSTREAM_SYSTEM', 'SCHEMA_NAME', 'character varying', 256),
            ('P_UPSTREAM_SYSTEM', 'STATUS_CODE', 'character varying', 32),
            ('P_UPSTREAM_SYSTEM', 'OWNER_NAME', 'character varying', 128),
            ('P_UPSTREAM_SYSTEM', 'DEPT_NAME', 'character varying', 128),
            ('P_UPSTREAM_SYSTEM', 'SYSTEM_DESC', 'character varying', 2000),
            ('P_UPSTREAM_SYSTEM', 'UNLOAD_COUNT', 'integer', NULL),
            ('P_UPSTREAM_SYSTEM', 'IS_DELETED', 'character', 1),
            ('P_UPSTREAM_SYSTEM', 'CREATED_BY', 'character varying', 64),
            ('P_UPSTREAM_SYSTEM', 'CREATED_AT', 'timestamp without time zone', NULL),
            ('P_UPSTREAM_SYSTEM', 'UPDATED_BY', 'character varying', 64),
            ('P_UPSTREAM_SYSTEM', 'UPDATED_AT', 'timestamp without time zone', NULL),

            ('P_UPSTREAM_UNLOAD_TIME', 'TIME_PK', 'bigint', NULL),
            ('P_UPSTREAM_UNLOAD_TIME', 'SYSTEM_PK', 'bigint', NULL),
            ('P_UPSTREAM_UNLOAD_TIME', 'UNLOAD_TIME', 'character varying', 8),
            ('P_UPSTREAM_UNLOAD_TIME', 'DISPLAY_ORDER', 'integer', NULL),
            ('P_UPSTREAM_UNLOAD_TIME', 'IS_DELETED', 'character', 1),
            ('P_UPSTREAM_UNLOAD_TIME', 'CREATED_BY', 'character varying', 64),
            ('P_UPSTREAM_UNLOAD_TIME', 'CREATED_AT', 'timestamp without time zone', NULL),
            ('P_UPSTREAM_UNLOAD_TIME', 'UPDATED_BY', 'character varying', 64),
            ('P_UPSTREAM_UNLOAD_TIME', 'UPDATED_AT', 'timestamp without time zone', NULL)
    ) AS t(table_name, column_name, expected_data_type, expected_char_length)
),
actual_columns AS (
    SELECT
        UPPER(table_name) AS table_name,
        UPPER(column_name) AS column_name,
        LOWER(data_type) AS actual_data_type,
        character_maximum_length AS actual_char_length
    FROM information_schema.columns
    WHERE UPPER(table_schema) = (SELECT schema_name FROM params)
)
SELECT
    'column_checklist' AS report_name,
    e.table_name,
    e.column_name,
    CASE
        WHEN a.column_name IS NULL THEN 'MISSING'
        WHEN a.actual_data_type <> e.expected_data_type THEN 'TYPE_MISMATCH'
        WHEN COALESCE(a.actual_char_length, -1) <> COALESCE(e.expected_char_length, -1) THEN 'LENGTH_MISMATCH'
        ELSE 'OK'
    END AS status,
    e.expected_data_type AS expected_type,
    e.expected_char_length AS expected_length,
    a.actual_data_type AS actual_type,
    a.actual_char_length AS actual_length
FROM expected_columns e
LEFT JOIN actual_columns a
  ON a.table_name = e.table_name
 AND a.column_name = e.column_name
ORDER BY e.table_name, e.column_name;


WITH params AS (
    SELECT UPPER('dwp') AS schema_name
),
expected_indexes AS (
    SELECT * FROM (
        VALUES
            ('INDEX', 'P_ADMIN_USER', 'IDX_P_ADMIN_USER_UK_01'),
            ('INDEX', 'P_ASSET_DOMAIN', 'IDX_P_ASSET_DOMAIN_UK_01'),
            ('INDEX', 'P_ASSET_LAYER', 'IDX_P_ASSET_LAYER_UK_01'),
            ('INDEX', 'P_ASSET_TABLE', 'IDX_P_ASSET_TABLE_UK_01'),
            ('INDEX', 'P_ASSET_FIELD', 'IDX_P_ASSET_FIELD_UK_01'),
            ('INDEX', 'P_CODE_CATEGORY', 'IDX_P_CODE_CATEGORY_UK_01'),
            ('INDEX', 'P_CODE_ITEM', 'IDX_P_CODE_ITEM_UK_01'),
            ('INDEX', 'P_FIELD_MAPPING_TABLE', 'IDX_P_FIELD_MAPPING_TABLE_UK_01'),
            ('INDEX', 'P_INDICATOR_ITEM', 'IDX_P_INDICATOR_ITEM_UK_01'),
            ('INDEX', 'P_INDICATOR_PATH_CONFIG', 'IDX_P_INDICATOR_PATH_CONFIG_UK_01'),
            ('INDEX', 'P_INDICATOR_PATH_CONFIG', 'IDX_P_INDICATOR_PATH_CONFIG_UK_02'),
            ('INDEX', 'P_MENU', 'IDX_P_MENU_UK_01'),
            ('INDEX', 'P_PUSH_SYSTEM', 'IDX_P_PUSH_SYSTEM_UK_01'),
            ('INDEX', 'P_PUSH_JOB', 'IDX_P_PUSH_JOB_UK_01'),
            ('INDEX', 'P_ROOT_CATEGORY', 'IDX_P_ROOT_CATEGORY_UK_01'),
            ('INDEX', 'P_ROOT_ITEM', 'IDX_P_ROOT_ITEM_UK_01'),
            ('INDEX', 'P_UPSTREAM_SYSTEM', 'IDX_P_UPSTREAM_SYSTEM_UK_01'),
            ('INDEX', 'P_UPSTREAM_SYSTEM', 'IDX_P_UPSTREAM_SYSTEM_UK_02'),
            ('INDEX', 'P_UPSTREAM_UNLOAD_TIME', 'IDX_P_UPSTREAM_UNLOAD_TIME_UK_01'),
            ('CONSTRAINT', 'P_REPORT_ASSET', 'PK_P_REPORT_ASSET'),
            ('CONSTRAINT', 'P_REPORT_ASSET', 'UK_P_REPORT_ASSET_01'),
            ('CONSTRAINT', 'P_FIELD_MAPPING_TABLE', 'FK_P_FIELD_MAPPING_TABLE_UPSTREAM')
    ) AS t(object_type, table_name, object_name)
),
actual_indexes AS (
    SELECT
        'INDEX' AS object_type,
        UPPER(tablename) AS table_name,
        UPPER(indexname) AS object_name
    FROM pg_indexes
    WHERE UPPER(schemaname) = (SELECT schema_name FROM params)
),
actual_constraints AS (
    SELECT
        'CONSTRAINT' AS object_type,
        UPPER(table_name) AS table_name,
        UPPER(constraint_name) AS object_name
    FROM information_schema.table_constraints
    WHERE UPPER(table_schema) = (SELECT schema_name FROM params)
)
SELECT
    'index_constraint_checklist' AS report_name,
    e.object_type,
    e.table_name,
    e.object_name,
    CASE
        WHEN ai.object_name IS NOT NULL OR ac.object_name IS NOT NULL THEN 'OK'
        ELSE 'MISSING'
    END AS status
FROM expected_indexes e
LEFT JOIN actual_indexes ai
  ON ai.object_type = e.object_type
 AND ai.table_name = e.table_name
 AND ai.object_name = e.object_name
LEFT JOIN actual_constraints ac
  ON ac.object_type = e.object_type
 AND ac.table_name = e.table_name
 AND ac.object_name = e.object_name
ORDER BY e.object_type, e.table_name, e.object_name;


-- Optional second-stage data audit
-- Run these only after the structure checklist is basically OK.
--
-- 1) 2026-06-21 indicator dimension code 4-char -> 3-char
-- SELECT 'old_dimension_code_in_indicator_item' AS check_item, dimension_code, COUNT(*) AS row_count
-- FROM dwp.p_indicator_item
-- WHERE LOWER(dimension_code) IN ('cust', 'cont', 'dubl', 'empl')
-- GROUP BY dimension_code
-- ORDER BY dimension_code;
--
-- SELECT 'old_dimension_code_in_change_log_json' AS check_item,
--        SUM(CASE WHEN before_json LIKE '%"dimension": "cust"%' OR after_json LIKE '%"dimension": "cust"%' THEN 1 ELSE 0 END) AS cust_rows,
--        SUM(CASE WHEN before_json LIKE '%"dimension": "cont"%' OR after_json LIKE '%"dimension": "cont"%' THEN 1 ELSE 0 END) AS cont_rows,
--        SUM(CASE WHEN before_json LIKE '%"dimension": "dubl"%' OR after_json LIKE '%"dimension": "dubl"%' THEN 1 ELSE 0 END) AS dubl_rows,
--        SUM(CASE WHEN before_json LIKE '%"dimension": "empl"%' OR after_json LIKE '%"dimension": "empl"%' THEN 1 ELSE 0 END) AS empl_rows
-- FROM dwp.p_indicator_change_log;
--
-- 2) 2026-06-23 add missing upstream db types
-- SELECT 'missing_upstream_db_type_code' AS check_item, x.item_code
-- FROM (
--     SELECT 'DB2' AS item_code
--     UNION ALL
--     SELECT 'SQL_SERVER' AS item_code
-- ) x
-- LEFT JOIN dwp.p_code_item i
--   ON i.category_code = 'UPSTREAM_DB_TYPE'
--  AND i.item_code = x.item_code
-- WHERE i.item_code IS NULL;
--
-- 3) Indicator path seed rows
-- SELECT 'indicator_path_config_row_count' AS check_item, COUNT(*) AS row_count
-- FROM dwp.p_indicator_path_config;
