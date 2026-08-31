export const OPERATION_MODULES = ["数据仓库", "指标维护", "字段映射", "上游卸数", "下游推送", "词根管理", "报表资产", "API 资产", "血缘分析"];
export const OPERATION_TYPES = ["查询", "新增", "编辑", "启用", "禁用", "导出", "导入"];
export const OPERATION_RESULTS = [{ value: "success", name: "成功" }, { value: "failed", name: "失败" }];

const SUBJECTS = [
  ["数据仓库", "查询", "dwm_trade_sales_stat_1d", "查看全渠道销售汇总日表详情。"],
  ["指标维护", "新增", "ORD00004", "新增指标「平均客单价」。"],
  ["字段映射", "编辑", "ORDER_HEADER", "补充订单金额的单位换算规则。"],
  ["上游卸数", "查询", "up_inventory", "查看库存中心的演示卸数配置。"],
  ["下游推送", "新增", "JOB_REPL_02", "新增仓店补货建议输出任务。"],
  ["词根管理", "新增", "stock", "新增库存标准词根。"],
  ["报表资产", "查询", "RPT_RETAIL_DAILY", "查看全渠道零售经营日报。"],
  ["API 资产", "启用", "STOCK_QUERY", "启用商品库存查询 API。"],
  ["血缘分析", "查询", "DWS_TRADE_SALES_STAT_1D", "查询销售汇总表的上下游血缘。"],
  ["指标维护", "禁用", "SVC00005", "禁用商品平均评分指标以演示状态管理。"],
];

export const OPERATION_LOGS = Array.from({ length: 20 }, (_, index) => {
  const [moduleName, operationType, operationObject, operationDesc] = SUBJECTS[index % SUBJECTS.length];
  return {
    id: 2000 + index,
    userId: `USR${String((index % 8) + 1).padStart(3, "0")}`,
    userName: "演示数据维护组",
    deptName: ["平台运营部", "商品运营部", "会员运营部", "供应链部"][index % 4],
    moduleName,
    operationType,
    operationObject,
    operationDesc,
    requestMethod: operationType === "查询" ? "GET" : "POST",
    requestUrl: `/api/demo/audit/${index + 1}`,
    requestParams: JSON.stringify({ demo: true, object: operationObject }),
    resultStatus: index === 19 ? "failed" : "success",
    errorMessage: index === 19 ? "演示校验未通过：缺少指标说明" : "",
    ipAddress: "demo-client",
    userAgent: "Demo Browser",
    costTimeMs: 60 + index * 7,
    remark: "完全虚构的操作审计记录。",
    createdAt: `2026-07-${String((index % 20) + 1).padStart(2, "0")} 10:00:00`,
  };
});
