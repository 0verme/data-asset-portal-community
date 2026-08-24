#!/usr/bin/env python3
"""Seed curated term-root test data into a non-production database profile."""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from app.db.facade import database_transaction, execute_sql, fetch_all, get_db_profile


SEED_OPERATOR = "term_root_seed"
SEED_CHANGE_TYPE = "SEED_TERM_ROOT"
VALID_ABBR = re.compile(r"^[a-z0-9_]+$")

# Keep the test corpus explicit: it is a maintained naming-reference sample,
# not randomly generated display data.  Categories intentionally use only the
# values already configured in dwp.p_root_category.
_ROWS = """
acct|account|账户|业务对象|用于 acct_no、acct_name
cust|customer|客户|业务对象|用于 cust_id、cust_name
client|client|客户主体|业务对象|用于 client_no、client_type
party|party|参与方|业务对象|用于 party_id、party_role
user|user|用户|业务对象|用于 user_id、user_name
member|member|会员|业务对象|用于 member_no、member_level
emp|employee|员工|业务对象|用于 emp_id、emp_name
staff|staff|职员|业务对象|用于 staff_no、staff_dept
org|organization|机构|业务对象|用于 org_id、org_name
dept|department|部门|业务对象|用于 dept_code、dept_name
branch|branch|分支机构|业务对象|用于 branch_id、branch_name
company|company|公司|业务对象|用于 company_id、company_name
vendor|vendor|供应商|业务对象|用于 vendor_id、vendor_name
merchant|merchant|商户|业务对象|用于 merchant_id、merchant_name
counterparty|counterparty|交易对手方|业务对象|用于 counterparty_id、counterparty_name
beneficiary|beneficiary|受益人|业务对象|用于 beneficiary_acct、beneficiary_name
agent|agent|代理人|业务对象|用于 agent_id、agent_name
manager|manager|客户经理|业务对象|用于 manager_id、manager_name
role|role|角色|业务对象|用于 role_code、role_name
team|team|团队|业务对象|用于 team_id、team_name
group|group|群组|业务对象|用于 group_id、group_name
contact|contact|联系人|业务对象|用于 contact_name、contact_type
addr|address|地址|业务对象|用于 addr_line、addr_code
region|region|区域|业务对象|用于 region_code、region_name
province|province|省份|业务对象|用于 province_code、province_name
city|city|城市|业务对象|用于 city_code、city_name
district|district|区县|业务对象|用于 district_code、district_name
country|country|国家或地区|业务对象|用于 country_code、country_name
currency|currency|币种|业务对象|用于 currency_code、currency_name
bank|bank|银行|业务对象|用于 bank_code、bank_name
card|card|银行卡|业务对象|用于 card_no、card_type
wallet|wallet|电子钱包|业务对象|用于 wallet_id、wallet_bal
loan|loan|贷款|业务对象|用于 loan_no、loan_bal
deposit|deposit|存款|业务对象|用于 deposit_acct、deposit_rate
policy|policy|保单|业务对象|用于 policy_no、policy_status
claim|claim|理赔申请|业务对象|用于 claim_no、claim_amt
contract|contract|合同|业务对象|用于 contract_no、contract_date
agreement|agreement|协议|业务对象|用于 agreement_id、agreement_type
prod|product|产品简称|业务对象|用于 prod_id、prod_type
service|service|服务|业务对象|用于 service_code、service_name
package|package|产品套餐|业务对象|用于 package_id、package_name
order|order|订单|业务对象|用于 order_no、order_status
invoice|invoice|发票|业务对象|用于 invoice_no、invoice_amt
bill|bill|账单|业务对象|用于 bill_no、bill_date
receipt|receipt|回单|业务对象|用于 receipt_no、receipt_time
txn|transaction|交易|业务对象|用于 txn_id、txn_time
pay|payment|支付简称|业务对象|用于 pay_no、pay_status
transfer|transfer|转账|业务对象|用于 transfer_id、transfer_amt
settlement|settlement|清算结算|业务对象|用于 settlement_date、settlement_amt
refund|refund|退款|业务对象|用于 refund_id、refund_amt
fee|fee|费用|业务对象|用于 fee_type、fee_amt
commission|commission|佣金|业务对象|用于 commission_amt、commission_rate
interest|interest|利息|业务对象|用于 interest_amt、interest_rate
principal|principal|本金|业务对象|用于 principal_amt、principal_bal
balance|balance|余额|业务对象|用于 balance_amt、available_balance
limit|limit|额度|业务对象|用于 credit_limit、limit_amt
credit|credit|授信|业务对象|用于 credit_no、credit_limit
collateral|collateral|担保物|业务对象|用于 collateral_id、collateral_value
guarantee|guarantee|保证担保|业务对象|用于 guarantee_no、guarantee_amt
risk|risk|风险|业务对象|用于 risk_type、risk_level
rating|rating|评级|业务对象|用于 rating_code、rating_date
channel|channel|渠道|业务对象|用于 channel_code、channel_name
chnl|channel|渠道简称|业务对象|用于 chnl_id、chnl_type
terminal|terminal|终端|业务对象|用于 terminal_id、terminal_type
device|device|设备|业务对象|用于 device_id、device_model
batch|batch|批次|业务对象|用于 batch_no、batch_date
file|file|文件|业务对象|用于 file_name、file_path
record|record|记录|业务对象|用于 record_id、record_type
event|event|事件|业务对象|用于 event_id、event_time
message|message|消息|业务对象|用于 message_id、message_type
bal|balance|余额|度量|用于 acct_bal、available_bal
cnt|count|数量|度量|用于 order_cnt、error_cnt
qty|quantity|数量|度量|用于 trade_qty、stock_qty
num|number|数值|度量|用于 item_num、sequence_num
rate|rate|比率|度量|用于 interest_rate、success_rate
ratio|ratio|比例|度量|用于 debt_ratio、share_ratio
score|score|评分|度量|用于 credit_score、risk_score
value|value|数值|度量|用于 asset_value、metric_value
price|price|价格|度量|用于 unit_price、close_price
cost|cost|成本|度量|用于 cost_amt、service_cost
tax|tax|税额|度量|用于 tax_amt、tax_rate
discount|discount|折扣|度量|用于 discount_amt、discount_rate
profit|profit|利润|度量|用于 profit_amt、profit_rate
loss|loss|损失|度量|用于 loss_amt、loss_rate
revenue|revenue|收入|度量|用于 revenue_amt、revenue_rate
income|income|收益|度量|用于 income_amt、income_type
debit|debit|借方金额|度量|用于 debit_amt、debit_cnt
credit_amt|credit amount|贷方金额|度量|用于 credit_amt、credit_cnt
net|net amount|净额|度量|用于 net_amt、net_balance
gross|gross amount|总额|度量|用于 gross_amt、gross_income
avg|average|平均值|度量|用于 avg_bal、avg_price
max|maximal value|最大值|度量|用于 max_amt、max_date
min|minimal value|最小值|度量|用于 min_amt、min_date
sum|sum|合计|度量|用于 sum_amt、sum_qty
total|total|总计|度量|用于 total_amt、total_cnt
diff|difference|差额|度量|用于 balance_diff、amount_diff
variance|variance|方差|度量|用于 variance_amt、variance_rate
percent|percentage|百分比|度量|用于 percent_value、percent_rank
quota|quota|配额|度量|用于 quota_amt、quota_used
volume|volume|交易量|度量|用于 trade_volume、volume_amt
turnover|turnover|成交额|度量|用于 turnover_amt、turnover_rate
exposure|exposure|风险暴露|度量|用于 exposure_amt、exposure_ratio
available|available amount|可用金额|度量|用于 available_amt、available_bal
used|used amount|已用金额|度量|用于 used_amt、used_limit
active|active|启用标志|状态标志|用于 is_active、active_flag
enabled|enabled|启用状态|状态标志|用于 enabled_flag、enabled_time
valid|valid|有效标志|状态标志|用于 valid_flag、valid_status
invalid|invalid|无效标志|状态标志|用于 invalid_flag、invalid_reason
deleted|deleted|删除标志|状态标志|用于 is_deleted、deleted_at
locked|locked|锁定标志|状态标志|用于 locked_flag、locked_time
frozen|frozen|冻结标志|状态标志|用于 frozen_flag、frozen_amt
closed|closed|关闭状态|状态标志|用于 closed_flag、closed_date
open|open|开户状态|状态标志|用于 open_flag、open_date
pending|pending|待处理状态|状态标志|用于 pending_flag、pending_reason
approved|approved|已审批状态|状态标志|用于 approved_flag、approved_by
rejected|rejected|已拒绝状态|状态标志|用于 rejected_flag、reject_reason
success|success|成功状态|状态标志|用于 success_flag、success_time
failed|failed|失败状态|状态标志|用于 failed_flag、fail_reason
cancelled|cancelled|已取消状态|状态标志|用于 cancelled_flag、cancel_time
completed|completed|已完成状态|状态标志|用于 completed_flag、completed_time
processed|processed|已处理状态|状态标志|用于 processed_flag、processed_time
verified|verified|已核验状态|状态标志|用于 verified_flag、verified_by
primary|primary|主标识|状态标志|用于 primary_flag、primary_acct
default|default|默认标志|状态标志|用于 default_flag、default_value
date|date|日期|时间|用于 business_date、start_date
time|time|时间|时间|用于 txn_time、create_time
ts|timestamp|时间戳|时间|用于 event_ts、update_ts
datetime|date time|日期时间|时间|用于 start_datetime、end_datetime
year|year|年度|时间|用于 fiscal_year、report_year
month|month|月份|时间|用于 report_month、settle_month
day|day|日|时间|用于 business_day、due_day
week|week|周|时间|用于 week_no、week_start_date
quarter|quarter|季度|时间|用于 fiscal_quarter、quarter_end_date
hour|hour|小时|时间|用于 hour_no、hour_start_time
minute|minute|分钟|时间|用于 minute_no、minute_time
second|second|秒|时间|用于 second_no、second_time
start|start|开始时间|时间|用于 start_date、start_time
end|end|结束时间|时间|用于 end_date、end_time
due|due date|到期日|时间|用于 due_date、due_time
expire|expiry|失效时间|时间|用于 expire_date、expire_time
effective|effective date|生效日|时间|用于 effective_date、effective_time
create|creation time|创建时间|时间|用于 create_time、create_date
update|update time|更新时间|时间|用于 update_time、update_date
load|load time|装载时间|时间|用于 load_time、load_date
id|identifier|标识|技术后缀|用于 cust_id、txn_id
no|number|编号|技术后缀|用于 acct_no、order_no
code|code|代码|技术后缀|用于 product_code、status_code
name|name|名称|技术后缀|用于 org_name、file_name
desc|description|描述|技术后缀|用于 root_desc、error_desc
type|type|类型|技术后缀|用于 txn_type、product_type
flag|flag|标志|技术后缀|用于 delete_flag、risk_flag
key|key|键值|技术后缀|用于 business_key、partition_key
seq|sequence|序号|技术后缀|用于 event_seq、detail_seq
sn|serial number|流水号|技术后缀|用于 serial_sn、voucher_sn
version|version|版本号|技术后缀|用于 data_version、rule_version
level|level|层级|技术后缀|用于 risk_level、member_level
rank|rank|排名|技术后缀|用于 rank_no、priority_rank
remark|remark|备注|技术后缀|用于 audit_remark、handle_remark
reason|reason|原因|技术后缀|用于 reject_reason、change_reason
source|source|来源|技术后缀|用于 data_source、source_system
target|target|目标|技术后缀|用于 target_table、target_system
path|path|路径|技术后缀|用于 file_path、menu_path
url|uniform resource locator|访问地址|技术后缀|用于 callback_url、service_url
ip|internet protocol address|网络地址|技术后缀|仅用于 ip_type、ip_version 等元数据字段
hash|hash value|哈希值|技术后缀|用于 content_hash、password_hash
json|json document|结构化文本|技术后缀|用于 ext_json、request_json
xml|xml document|XML 文本|技术后缀|用于 response_xml、config_xml
di|daily increment|日增量后缀|技术后缀|用于 acct_di、txn_di
df|daily full|日全量后缀|技术后缀|用于 cust_df、product_df
hi|history increment|历史增量后缀|技术后缀|用于 loan_hi、payment_hi
hf|history full|历史全量后缀|技术后缀|用于 contract_hf、order_hf
ods|operational data store|贴源层后缀|技术后缀|用于 ods_acct_di、ods_txn_df
dwd|data warehouse detail|明细层后缀|技术后缀|用于 dwd_txn_di、dwd_cust_df
dws|data warehouse service|汇总层后缀|技术后缀|用于 dws_cust_tag_df、dws_risk_di
ads|application data service|应用层后缀|技术后缀|用于 ads_sales_df、ads_risk_di
tmp|temporary|临时表后缀|技术后缀|用于 tmp_txn_check、tmp_cust_match
bak|backup|备份后缀|技术后缀|用于 acct_bak、order_bak
stg|staging|暂存层后缀|技术后缀|用于 stg_payment_di、stg_file_df
etl|extract transform load|数据加工标识|技术后缀|用于 etl_batch_id、etl_time
cdc|change data capture|变更数据捕获标识|技术后缀|用于 cdc_op_type、cdc_time
"""


def _seed_items():
    items = []
    for line in _ROWS.strip().splitlines():
        abbr, en, cn, cat, desc = (part.strip() for part in line.split("|"))
        items.append({"abbr": abbr, "en": en, "cn": cn, "cat": cat, "desc": desc})
    abbrs = [item["abbr"] for item in items]
    if len(items) != 180 or len(set(abbrs)) != len(abbrs) or any(not VALID_ABBR.fullmatch(abbr) for abbr in abbrs):
        raise RuntimeError("seed corpus must contain 180 unique lowercase abbreviations")
    return items


def _parser():
    parser = argparse.ArgumentParser(description=__doc__)
    command = parser.add_mutually_exclusive_group(required=True)
    command.add_argument("--dry-run", action="store_true")
    command.add_argument("--apply", action="store_true")
    command.add_argument("--cleanup", action="store_true")
    parser.add_argument("--limit", type=int, help="Apply or preview no more than this many corpus rows.")
    parser.add_argument("--profile", default=os.getenv("ASSET_DB_PROFILE", "primary"), help="Existing named DB profile.")
    parser.add_argument("--config", help="Existing database profile configuration file.")
    return parser


def _safe_target(profile, config):
    db_type = str(config.get("type", "")).lower()
    marker = " ".join(str(config.get(key, "")).lower() for key in ("host", "database")) + " " + profile.lower()
    if db_type != "postgres":
        raise RuntimeError("term-root seed only supports the PostgreSQL test profile")
    if any(word in marker for word in ("prod", "production")) or not any(word in marker for word in ("test", "dev", "local")):
        raise RuntimeError("refusing seed: profile must be explicitly marked test, dev, or local")
    return f"postgres:{config.get('host')}/{config.get('database')} schema={config.get('schema', 'dwp')}"


def _rows(profile, sql, params=None):
    columns, values = fetch_all(profile, sql, params=params)
    return [dict(zip(columns, row)) for row in values]


def _existing(profile):
    return {row["root_abbr"] for row in _rows(profile, "SELECT root_abbr FROM dwp.p_root_item")}


def _active_categories(profile):
    return {row["category_name"] for row in _rows(profile, "SELECT category_name FROM dwp.p_root_category WHERE is_deleted = 'N'")}


def _plan(profile, limit):
    items = _seed_items()
    if limit is not None:
        if limit <= 0:
            raise ValueError("--limit must be positive")
        items = items[:limit]
    categories = _active_categories(profile)
    missing_categories = sorted({item["cat"] for item in items} - categories)
    if missing_categories:
        raise RuntimeError(f"configured root categories missing: {', '.join(missing_categories)}")
    existing = _existing(profile)
    return items, [item for item in items if item["abbr"] not in existing], sorted(existing & {item["abbr"] for item in items})


def _apply(profile, items):
    with database_transaction():
        execute_sql(profile, "LOCK TABLE dwp.p_root_item, dwp.p_root_change_log IN EXCLUSIVE MODE", autocommit=False)
        existing = _existing(profile)
        pending = [item for item in items if item["abbr"] not in existing]
        if not pending:
            return 0, len(items)
        next_root_id = int(_rows(profile, "SELECT COALESCE(MAX(root_id), 0) + 1 AS next_id FROM dwp.p_root_item")[0]["next_id"])
        next_change_id = int(_rows(profile, "SELECT COALESCE(MAX(change_id), 0) + 1 AS next_id FROM dwp.p_root_change_log")[0]["next_id"])
        for offset, item in enumerate(pending):
            root_id = next_root_id + offset
            execute_sql(profile, """
INSERT INTO dwp.p_root_item
  (root_id, root_abbr, root_en_name, root_cn_name, category_name, root_desc, created_by, updated_by)
VALUES (?, ?, ?, ?, ?, ?, ?, ?)
""", autocommit=False, params=[root_id, item["abbr"], item["en"], item["cn"], item["cat"], item["desc"], SEED_OPERATOR, SEED_OPERATOR])
            execute_sql(profile, """
INSERT INTO dwp.p_root_change_log
  (change_id, root_id, root_abbr, change_type, change_summary, after_json, operator_name)
VALUES (?, ?, ?, ?, ?, ?, ?)
""", autocommit=False, params=[next_change_id + offset, root_id, item["abbr"], SEED_CHANGE_TYPE, "seed curated term root", json.dumps(item, ensure_ascii=False, sort_keys=True), SEED_OPERATOR])
    return len(pending), len(items) - len(pending)


def _cleanup(profile):
    with database_transaction():
        seeded = _rows(profile, "SELECT root_id FROM dwp.p_root_item WHERE created_by = ?", params=[SEED_OPERATOR])
        root_ids = [int(row["root_id"]) for row in seeded]
        if not root_ids:
            return 0
        placeholders = ", ".join("?" for _ in root_ids)
        execute_sql(profile, f"DELETE FROM dwp.p_root_change_log WHERE change_type = ? AND root_id IN ({placeholders})", autocommit=False, params=[SEED_CHANGE_TYPE, *root_ids])
        execute_sql(profile, f"DELETE FROM dwp.p_root_item WHERE root_id IN ({placeholders}) AND created_by = ?", autocommit=False, params=[*root_ids, SEED_OPERATOR])
        return len(root_ids)


def main(argv=None):
    args = _parser().parse_args(argv)
    if args.config:
        os.environ["ASSET_DB_CONFIG_PATH"] = args.config
    config = get_db_profile(args.profile)
    print(f"target={_safe_target(args.profile, config)} corpus={len(_seed_items())}")
    if args.cleanup:
        if args.limit is not None:
            raise ValueError("--limit cannot be used with --cleanup")
        print(f"action=cleanup deleted_roots={_cleanup(args.profile)}")
        return 0
    items, pending, duplicates = _plan(args.profile, args.limit)
    print(f"action={'dry-run' if args.dry_run else 'apply'} requested={len(items)} insertable={len(pending)} existing={len(duplicates)}")
    if duplicates:
        print("existing_abbrs=" + ",".join(duplicates))
    if args.dry_run:
        return 0
    inserted, skipped = _apply(args.profile, items)
    print(f"inserted={inserted} skipped_existing={skipped}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f"term-root seed failed: {error}", file=sys.stderr)
        raise SystemExit(1)
