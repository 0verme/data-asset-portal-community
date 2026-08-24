#!/usr/bin/env python3
"""Seed or remove deterministic DWA/DM asset metadata in a safe test database."""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from app.db.facade import database_transaction, execute_sql, fetch_all, get_db_profile


SEED_OPERATOR = "asset_layer_test_seed"
SEED_CHANGE_TYPE = "CREATE_TABLE"


def _field(
    name,
    cn,
    data_type,
    *,
    nullable=False,
    pk=False,
    part=False,
    enum=None,
):
    return {
        "name": name,
        "cn": cn,
        "type": data_type,
        "nullable": nullable,
        "pk": pk,
        "part": part,
        "enum": enum,
    }


def _daily_fields(key_name, key_cn, dimensions, metrics):
    return [
        _field(key_name, key_cn, "VARCHAR(64)", pk=True),
        *dimensions,
        *metrics,
        _field("dt", "数据日期分区", "VARCHAR(10)", part=True, enum="格式 yyyy-MM-dd，按天分区"),
        _field("etl_time", "数据写入（ETL）时间", "TIMESTAMP"),
    ]


ASSETS = [
    {
        "name": "dwa_pay_channel_stat_1d",
        "cn": "支付渠道公共汇总日表",
        "schema": "DWS_DWA",
        "layer": "DWA",
        "domain": "PAY",
        "owner": "张伟",
        "grain": "支付渠道 + 日期",
        "cycle": "每日 T+1",
        "desc": "按支付渠道汇总交易笔数、金额、成功率和手续费，为支付分析及集市应用提供统一公共指标。",
        "fields": _daily_fields(
            "channel_code",
            "支付渠道编码",
            [_field("channel_name", "支付渠道名称", "VARCHAR(128)")],
            [
                _field("pay_cnt", "支付笔数", "BIGINT"),
                _field("pay_amt", "支付金额（元）", "NUMERIC(18,2)"),
                _field("success_cnt", "成功支付笔数", "BIGINT"),
                _field("success_rate", "支付成功率", "NUMERIC(10,4)"),
                _field("fee_amt", "手续费金额（元）", "NUMERIC(18,2)"),
            ],
        ),
    },
    {
        "name": "dwa_trade_order_stat_1d",
        "cn": "交易订单公共汇总日表",
        "schema": "DWS_DWA",
        "layer": "DWA",
        "domain": "TRADE",
        "owner": "李娜",
        "grain": "订单类型 + 日期",
        "cycle": "每日 T+1",
        "desc": "按订单类型沉淀下单、支付、退款及成交额等公共交易指标，统一支撑经营分析。",
        "fields": _daily_fields(
            "order_type",
            "订单类型",
            [_field("merchant_type", "商户类型", "VARCHAR(64)", enum="DIRECT-直营 / PLATFORM-平台")],
            [
                _field("order_cnt", "下单笔数", "BIGINT"),
                _field("paid_order_cnt", "支付订单笔数", "BIGINT"),
                _field("gmv", "成交总额（元）", "NUMERIC(18,2)"),
                _field("refund_cnt", "退款笔数", "BIGINT"),
                _field("refund_amt", "退款金额（元）", "NUMERIC(18,2)"),
            ],
        ),
    },
    {
        "name": "dwa_acct_balance_stat_1d",
        "cn": "账户余额公共汇总日表",
        "schema": "DWS_DWA",
        "layer": "DWA",
        "domain": "ACCT",
        "owner": "王芳",
        "grain": "账户类型 + 日期",
        "cycle": "每日全量",
        "desc": "按账户类型汇总账户数量、余额及冻结资金，形成资金存量分析的公共口径。",
        "fields": _daily_fields(
            "acct_type",
            "账户类型",
            [_field("currency_code", "币种编码", "VARCHAR(16)")],
            [
                _field("acct_cnt", "账户数量", "BIGINT"),
                _field("total_balance", "账户总余额（元）", "NUMERIC(20,2)"),
                _field("available_balance", "可用余额（元）", "NUMERIC(20,2)"),
                _field("frozen_balance", "冻结余额（元）", "NUMERIC(20,2)"),
                _field("active_acct_cnt", "活跃账户数量", "BIGINT"),
            ],
        ),
    },
    {
        "name": "dwa_user_active_stat_1d",
        "cn": "用户活跃公共汇总日表",
        "schema": "DWS_DWA",
        "layer": "DWA",
        "domain": "USER",
        "owner": "刘洋",
        "grain": "用户分群 + 日期",
        "cycle": "每日 T+1",
        "desc": "按用户分群汇总活跃、登录、下单与支付行为，统一用户活跃度分析口径。",
        "fields": _daily_fields(
            "user_segment",
            "用户分群",
            [_field("reg_channel", "注册渠道", "VARCHAR(64)")],
            [
                _field("active_user_cnt", "活跃用户数", "BIGINT"),
                _field("login_cnt", "登录次数", "BIGINT"),
                _field("order_user_cnt", "下单用户数", "BIGINT"),
                _field("pay_user_cnt", "支付用户数", "BIGINT"),
                _field("avg_active_duration", "人均活跃时长（秒）", "NUMERIC(18,2)"),
            ],
        ),
    },
    {
        "name": "dwa_risk_trans_stat_1d",
        "cn": "风险交易公共汇总日表",
        "schema": "DWS_DWA",
        "layer": "DWA",
        "domain": "RISK",
        "owner": "陈静",
        "grain": "风险等级 + 日期",
        "cycle": "每日 T+1",
        "desc": "按风险等级汇总交易、命中、拦截及疑似损失金额，为风险监控提供统一指标。",
        "fields": _daily_fields(
            "risk_level",
            "风险等级",
            [_field("risk_scene", "风险场景", "VARCHAR(64)")],
            [
                _field("trans_cnt", "交易笔数", "BIGINT"),
                _field("hit_cnt", "风险命中笔数", "BIGINT"),
                _field("blocked_cnt", "拦截笔数", "BIGINT"),
                _field("risk_amt", "风险交易金额（元）", "NUMERIC(18,2)"),
                _field("loss_amt", "疑似损失金额（元）", "NUMERIC(18,2)"),
            ],
        ),
    },
    {
        "name": "dwa_mkt_campaign_stat_1d",
        "cn": "营销活动公共汇总日表",
        "schema": "DWS_DWA",
        "layer": "DWA",
        "domain": "MKT",
        "owner": "赵磊",
        "grain": "营销活动 + 日期",
        "cycle": "每日 T+1",
        "desc": "按活动汇总曝光、参与、转化、成交额和成本，提供统一的营销效果公共指标。",
        "fields": _daily_fields(
            "campaign_id",
            "营销活动ID",
            [_field("campaign_name", "营销活动名称", "VARCHAR(128)")],
            [
                _field("exposure_uv", "曝光用户数", "BIGINT"),
                _field("join_uv", "参与用户数", "BIGINT"),
                _field("convert_uv", "转化用户数", "BIGINT"),
                _field("gmv", "活动成交额（元）", "NUMERIC(18,2)"),
                _field("campaign_cost", "活动成本（元）", "NUMERIC(18,2)"),
            ],
        ),
    },
    {
        "name": "dm_pay_operation_1d",
        "cn": "支付运营集市日表",
        "schema": "DWS_DM",
        "layer": "DM",
        "domain": "PAY",
        "owner": "张伟",
        "grain": "支付业务线 + 日期",
        "cycle": "每日 T+1",
        "desc": "面向支付运营看板，汇总支付规模、成功率、客单价与渠道成本等核心经营指标。",
        "fields": _daily_fields(
            "biz_line",
            "支付业务线",
            [_field("channel_group", "渠道分组", "VARCHAR(64)")],
            [
                _field("pay_user_cnt", "支付用户数", "BIGINT"),
                _field("pay_cnt", "支付笔数", "BIGINT"),
                _field("pay_amt", "支付金额（元）", "NUMERIC(20,2)"),
                _field("success_rate", "支付成功率", "NUMERIC(10,4)"),
                _field("avg_order_amt", "平均支付金额（元）", "NUMERIC(18,2)"),
            ],
        ),
    },
    {
        "name": "dm_trade_operation_1d",
        "cn": "交易运营集市日表",
        "schema": "DWS_DM",
        "layer": "DM",
        "domain": "TRADE",
        "owner": "李娜",
        "grain": "交易业务线 + 日期",
        "cycle": "每日 T+1",
        "desc": "面向交易运营看板，汇总订单、成交、退款、转化率和客单价等经营指标。",
        "fields": _daily_fields(
            "biz_line",
            "交易业务线",
            [_field("merchant_level", "商户等级", "VARCHAR(32)")],
            [
                _field("order_cnt", "订单笔数", "BIGINT"),
                _field("paid_order_cnt", "支付订单笔数", "BIGINT"),
                _field("gmv", "成交总额（元）", "NUMERIC(20,2)"),
                _field("refund_rate", "退款率", "NUMERIC(10,4)"),
                _field("conversion_rate", "下单支付转化率", "NUMERIC(10,4)"),
            ],
        ),
    },
    {
        "name": "dm_acct_fund_overview_1d",
        "cn": "账户资金总览集市日表",
        "schema": "DWS_DM",
        "layer": "DM",
        "domain": "ACCT",
        "owner": "王芳",
        "grain": "机构 + 币种 + 日期",
        "cycle": "每日全量",
        "desc": "面向资金管理看板，展示账户规模、资金余额、冻结占比及当日资金净流入。",
        "fields": _daily_fields(
            "org_code",
            "机构编码",
            [_field("currency_code", "币种编码", "VARCHAR(16)")],
            [
                _field("acct_cnt", "账户数量", "BIGINT"),
                _field("total_balance", "账户总余额（元）", "NUMERIC(20,2)"),
                _field("frozen_ratio", "冻结余额占比", "NUMERIC(10,4)"),
                _field("inflow_amt", "当日流入金额（元）", "NUMERIC(20,2)"),
                _field("net_inflow_amt", "当日净流入金额（元）", "NUMERIC(20,2)"),
            ],
        ),
    },
    {
        "name": "dm_user_growth_1d",
        "cn": "用户增长集市日表",
        "schema": "DWS_DM",
        "layer": "DM",
        "domain": "USER",
        "owner": "刘洋",
        "grain": "获客渠道 + 日期",
        "cycle": "每日 T+1",
        "desc": "面向用户增长分析，汇总新增、活跃、留存、付费和流失等关键用户指标。",
        "fields": _daily_fields(
            "acquisition_channel",
            "获客渠道",
            [_field("user_segment", "用户分群", "VARCHAR(64)")],
            [
                _field("new_user_cnt", "新增用户数", "BIGINT"),
                _field("active_user_cnt", "活跃用户数", "BIGINT"),
                _field("retention_rate_7d", "七日留存率", "NUMERIC(10,4)"),
                _field("pay_user_cnt", "付费用户数", "BIGINT"),
                _field("churn_user_cnt", "流失用户数", "BIGINT"),
            ],
        ),
    },
    {
        "name": "dm_risk_monitor_1d",
        "cn": "风险监控集市日表",
        "schema": "DWS_DM",
        "layer": "DM",
        "domain": "RISK",
        "owner": "陈静",
        "grain": "风险场景 + 日期",
        "cycle": "每日 T+1",
        "desc": "面向风险监控大盘，汇总风险事件、拦截率、风险敞口及疑似损失等指标。",
        "fields": _daily_fields(
            "risk_scene",
            "风险场景",
            [_field("risk_level", "风险等级", "VARCHAR(16)")],
            [
                _field("event_cnt", "风险事件数", "BIGINT"),
                _field("blocked_cnt", "成功拦截数", "BIGINT"),
                _field("blocked_rate", "风险拦截率", "NUMERIC(10,4)"),
                _field("exposure_amt", "风险敞口金额（元）", "NUMERIC(20,2)"),
                _field("loss_amt", "疑似损失金额（元）", "NUMERIC(20,2)"),
            ],
        ),
    },
    {
        "name": "dm_mkt_roi_1d",
        "cn": "营销投入产出集市日表",
        "schema": "DWS_DM",
        "layer": "DM",
        "domain": "MKT",
        "owner": "赵磊",
        "grain": "营销渠道 + 日期",
        "cycle": "每日 T+1",
        "desc": "面向营销决策看板，汇总投入、成交、转化、获客成本和投入产出比。",
        "fields": _daily_fields(
            "marketing_channel",
            "营销渠道",
            [_field("campaign_type", "活动类型", "VARCHAR(64)")],
            [
                _field("campaign_cnt", "活动数量", "BIGINT"),
                _field("convert_user_cnt", "转化用户数", "BIGINT"),
                _field("gmv", "活动成交额（元）", "NUMERIC(20,2)"),
                _field("marketing_cost", "营销投入（元）", "NUMERIC(20,2)"),
                _field("roi", "投入产出比", "NUMERIC(10,4)", nullable=True),
            ],
        ),
    },
]


def _parser():
    parser = argparse.ArgumentParser(description=__doc__)
    command = parser.add_mutually_exclusive_group(required=True)
    command.add_argument("--dry-run", action="store_true")
    command.add_argument("--apply", action="store_true")
    command.add_argument("--cleanup", action="store_true")
    parser.add_argument("--profile", required=True, help="Existing named DB profile; never a connection string.")
    parser.add_argument("--config", help="Existing database profile configuration file.")
    return parser


def _safe_target(profile, config):
    db_type = str(config.get("type", "")).lower()
    marker = " ".join(
        str(config.get(key, "")).lower() for key in ("host", "database", "jdbc_url")
    ) + f" {profile.lower()}"
    if any(word in marker for word in ("prod", "production")):
        raise RuntimeError("refusing asset-layer test data: production marker detected")
    if db_type not in {"postgres", "gaussdb"}:
        raise RuntimeError(
            "refusing asset-layer test data: only postgres or gaussdb profiles are allowed"
        )
    if not any(word in marker for word in ("test", "dev", "local")):
        raise RuntimeError(
            "refusing asset-layer test data: profile/host/database must explicitly mark "
            "dev, test, or local"
        )
    if db_type == "postgres":
        return (
            f"postgres:{config.get('host')}:{config.get('port')}/{config.get('database')} "
            f"schema={config.get('schema', 'dwp')}"
        )
    return f"gaussdb:{config.get('jdbc_url')}"


def _rows(profile, sql, params=None):
    columns, values = fetch_all(profile, sql, params=params)
    return [dict(zip(columns, row)) for row in values]


def _asset_names():
    return [asset["name"] for asset in ASSETS]


def _placeholders(items):
    return ", ".join("?" for _ in items)


def _plan(profile):
    names = _asset_names()
    existing = _rows(
        profile,
        f"""
SELECT asset_id, table_name, schema_name, layer_code, created_by
FROM dwp.p_asset_table
WHERE table_name IN ({_placeholders(names)})
""",
        names,
    )
    by_name = {}
    for row in existing:
        by_name.setdefault(row["table_name"], []).append(row)

    conflicts = []
    already_seeded = []
    pending = []
    for asset in ASSETS:
        matches = by_name.get(asset["name"], [])
        valid_seed = (
            len(matches) == 1
            and matches[0]["created_by"] == SEED_OPERATOR
            and matches[0]["schema_name"] == asset["schema"]
            and matches[0]["layer_code"] == asset["layer"]
        )
        if valid_seed:
            already_seeded.append(asset)
        elif matches:
            conflicts.append(asset["name"])
        else:
            pending.append(asset)

    configured_domains = {
        row["domain_code"]
        for row in _rows(profile, "SELECT domain_code FROM dwp.p_asset_domain WHERE is_active = 'Y'")
    }
    configured_layers = {
        row["layer_code"]
        for row in _rows(profile, "SELECT layer_code FROM dwp.p_asset_layer WHERE is_active = 'Y'")
    }
    missing_domains = sorted({asset["domain"] for asset in ASSETS} - configured_domains)
    missing_layers = sorted({asset["layer"] for asset in ASSETS} - configured_layers)
    if missing_domains:
        raise RuntimeError(f"configured asset domains missing or inactive: {', '.join(missing_domains)}")
    if missing_layers:
        raise RuntimeError(f"configured asset layers missing or inactive: {', '.join(missing_layers)}")
    if conflicts:
        raise RuntimeError(f"asset names already owned by other data: {', '.join(sorted(conflicts))}")
    return pending, already_seeded


def _asset_snapshot(asset):
    return {
        "name": asset["name"],
        "cn": asset["cn"],
        "domain": asset["domain"],
        "layer": asset["layer"],
        "schema": asset["schema"],
        "owner": asset["owner"],
        "grain": asset["grain"],
        "cycle": asset["cycle"],
        "desc": asset["desc"],
        "fields": asset["fields"],
    }


def _apply(profile, config):
    with database_transaction():
        if config["type"] == "postgres":
            execute_sql(
                profile,
                "LOCK TABLE dwp.p_asset_table, dwp.p_asset_field, dwp.p_asset_change_log IN EXCLUSIVE MODE",
                autocommit=False,
            )
        pending, already_seeded = _plan(profile)
        if not pending:
            return 0, len(already_seeded)

        next_asset_id = int(
            _rows(profile, "SELECT COALESCE(MAX(asset_id), 0) + 1 AS next_id FROM dwp.p_asset_table")[0]["next_id"]
        )
        next_field_id = int(
            _rows(profile, "SELECT COALESCE(MAX(field_id), 0) + 1 AS next_id FROM dwp.p_asset_field")[0]["next_id"]
        )
        next_change_id = int(
            _rows(profile, "SELECT COALESCE(MAX(change_id), 0) + 1 AS next_id FROM dwp.p_asset_change_log")[0]["next_id"]
        )

        for asset_offset, asset in enumerate(pending):
            asset_id = next_asset_id + asset_offset
            execute_sql(
                profile,
                """
INSERT INTO dwp.p_asset_table (
  asset_id, table_name, table_cn_name, schema_name, layer_code, domain_code,
  owner_name, grain_desc, cycle_desc, table_desc, source_type, storage_type,
  status_code, field_count, is_deleted, created_by, updated_by
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'MANUAL', 'DWS', 'ACTIVE', ?, 'N', ?, ?)
""",
                autocommit=False,
                params=[
                    asset_id,
                    asset["name"],
                    asset["cn"],
                    asset["schema"],
                    asset["layer"],
                    asset["domain"],
                    asset["owner"],
                    asset["grain"],
                    asset["cycle"],
                    asset["desc"],
                    len(asset["fields"]),
                    SEED_OPERATOR,
                    SEED_OPERATOR,
                ],
            )
            for field_order, field in enumerate(asset["fields"], start=1):
                execute_sql(
                    profile,
                    """
INSERT INTO dwp.p_asset_field (
  field_id, asset_id, field_name, field_cn_name, data_type, field_order,
  nullable_flag, pk_flag, partition_flag, enum_desc, field_desc,
  is_deleted, created_by, updated_by
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'N', ?, ?)
""",
                    autocommit=False,
                    params=[
                        next_field_id,
                        asset_id,
                        field["name"],
                        field["cn"],
                        field["type"],
                        field_order,
                        "Y" if field["nullable"] else "N",
                        "Y" if field["pk"] else "N",
                        "Y" if field["part"] else "N",
                        field["enum"],
                        field["cn"],
                        SEED_OPERATOR,
                        SEED_OPERATOR,
                    ],
                )
                next_field_id += 1
            execute_sql(
                profile,
                """
INSERT INTO dwp.p_asset_change_log (
  change_id, asset_id, table_name, change_type, change_summary,
  before_json, after_json, operator_name
) VALUES (?, ?, ?, ?, ?, NULL, ?, ?)
""",
                autocommit=False,
                params=[
                    next_change_id + asset_offset,
                    asset_id,
                    asset["name"],
                    SEED_CHANGE_TYPE,
                    "seed DWA/DM test asset metadata",
                    json.dumps(_asset_snapshot(asset), ensure_ascii=False, sort_keys=True),
                    SEED_OPERATOR,
                ],
            )
    return len(pending), len(already_seeded)


def _cleanup(profile):
    names = _asset_names()
    with database_transaction():
        seeded = _rows(
            profile,
            f"""
SELECT asset_id
FROM dwp.p_asset_table
WHERE created_by = ? AND table_name IN ({_placeholders(names)})
""",
            [SEED_OPERATOR, *names],
        )
        asset_ids = [int(row["asset_id"]) for row in seeded]
        if not asset_ids:
            return 0
        placeholders = _placeholders(asset_ids)
        execute_sql(
            profile,
            f"DELETE FROM dwp.p_asset_change_log WHERE asset_id IN ({placeholders})",
            autocommit=False,
            params=asset_ids,
        )
        execute_sql(
            profile,
            f"DELETE FROM dwp.p_asset_field WHERE asset_id IN ({placeholders}) AND created_by = ?",
            autocommit=False,
            params=[*asset_ids, SEED_OPERATOR],
        )
        execute_sql(
            profile,
            f"DELETE FROM dwp.p_asset_table WHERE asset_id IN ({placeholders}) AND created_by = ?",
            autocommit=False,
            params=[*asset_ids, SEED_OPERATOR],
        )
        return len(asset_ids)


def main(argv=None):
    args = _parser().parse_args(argv)
    if args.config:
        os.environ["ASSET_DB_CONFIG_PATH"] = args.config
    config = get_db_profile(args.profile)
    print(f"target={_safe_target(args.profile, config)} assets={len(ASSETS)} dwa=6 dm=6")
    if args.cleanup:
        print(f"action=cleanup deleted_assets={_cleanup(args.profile)}")
        return 0
    pending, already_seeded = _plan(args.profile)
    print(
        f"action={'dry-run' if args.dry_run else 'apply'} "
        f"insertable={len(pending)} existing_seeded={len(already_seeded)}"
    )
    if args.dry_run:
        if pending:
            print("pending_assets=" + ",".join(asset["name"] for asset in pending))
        return 0
    inserted, skipped = _apply(args.profile, config)
    print(f"inserted={inserted} skipped_existing={skipped}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f"asset-layer seed failed: {error}", file=sys.stderr)
        raise SystemExit(1)
