-- data-asset-portal application DDL
-- module: lineage
-- scope: persistent lineage snapshots, nodes, and relation evidence
-- schema: dwp
-- target: dws-compatible

CREATE TABLE IF NOT EXISTS dwp.p_lineage_snapshot (
    snapshot_id       VARCHAR(128) NOT NULL,
    generated_at      TIMESTAMP    NOT NULL,
    generator_name    VARCHAR(128) NOT NULL,
    generator_version VARCHAR(64)  NOT NULL,
    import_batch_id   VARCHAR(128) NOT NULL,
    status_code       VARCHAR(16)  NOT NULL,
    PRIMARY KEY (snapshot_id)
)
DISTRIBUTE BY REPLICATION;

CREATE UNIQUE INDEX idx_p_lineage_snapshot_batch
    ON dwp.p_lineage_snapshot (import_batch_id);

CREATE TABLE IF NOT EXISTS dwp.p_lineage_node (
    snapshot_id     VARCHAR(128) NOT NULL,
    node_id         VARCHAR(256) NOT NULL,
    kind_code       VARCHAR(32)  NOT NULL,
    node_name       VARCHAR(256) NOT NULL,
    display_name    VARCHAR(512) NOT NULL,
    namespace_name  VARCHAR(128) NOT NULL,
    attributes_json TEXT         NOT NULL,
    PRIMARY KEY (snapshot_id, node_id)
)
DISTRIBUTE BY HASH (snapshot_id);

CREATE TABLE IF NOT EXISTS dwp.p_lineage_edge (
    snapshot_id          VARCHAR(128)  NOT NULL,
    edge_id              VARCHAR(256)  NOT NULL,
    source_node_id       VARCHAR(256)  NOT NULL,
    target_node_id       VARCHAR(256)  NOT NULL,
    kind_code            VARCHAR(64)   NOT NULL,
    evidence_type        VARCHAR(64)   NOT NULL,
    source_record_id     VARCHAR(256)  NOT NULL,
    evidence_description VARCHAR(1000) NOT NULL,
    confidence_code      VARCHAR(16)   NOT NULL,
    generated_at         TIMESTAMP     NOT NULL,
    diagnostics_json     TEXT          NOT NULL,
    PRIMARY KEY (snapshot_id, edge_id)
)
DISTRIBUTE BY HASH (snapshot_id);

CREATE INDEX idx_p_lineage_node_lookup
    ON dwp.p_lineage_node (snapshot_id, kind_code, node_name);
CREATE INDEX idx_p_lineage_edge_source
    ON dwp.p_lineage_edge (snapshot_id, source_node_id);
CREATE INDEX idx_p_lineage_edge_target
    ON dwp.p_lineage_edge (snapshot_id, target_node_id);
