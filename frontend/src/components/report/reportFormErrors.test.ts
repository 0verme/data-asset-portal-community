import assert from "node:assert/strict";
import test from "node:test";

import { i18n, i18nReady } from "../../i18n/index.ts";
import { mapReportApiFieldErrors, validateReportForm } from "./reportFormErrors.ts";

const validReport = {
  code: "RPT_PAY_DAILY",
  name: "支付交易日报",
  type: "日报",
  domain: "支付业务",
  statPeriod: "日",
  statCaliber: "按日统计",
  ownerDept: "数据管理部",
  ownerName: "维护人",
  effectiveDate: "",
  expireDate: "",
};

test("report validation and server conflicts use translated UI messages without changing field names", async () => {
  await i18nReady;
  const t = i18n.getFixedT("en-US", "report");
  assert.deepEqual(validateReportForm({ ...validReport, code: "" }, t), {
    code: "Report code is required",
  });
  const error = Object.assign(new Error("Report already exists"), {
    status: 409,
    payload: { error: { code: "REPORT_ALREADY_EXISTS", message: "Report already exists" } },
  });
  assert.deepEqual(mapReportApiFieldErrors(error, t), {
    fieldErrors: { code: "This report code already exists. Change it and try again." },
    hasUnmappedErrors: false,
  });
});

test("report validation maps required errors to their field paths", () => {
  assert.deepEqual(validateReportForm({
    code: " ",
    name: "",
    type: "",
    domain: "",
    statPeriod: "",
    statCaliber: "",
    ownerDept: "",
    ownerName: "",
    effectiveDate: "",
    expireDate: "",
  }), {
    code: "报表编码不能为空",
    name: "报表名称不能为空",
    type: "报表类型不能为空",
    domain: "请选择主题域",
    ownerDept: "归属部门不能为空",
    ownerName: "负责人不能为空",
    statPeriod: "请选择统计周期",
    statCaliber: "请选择或输入统计口径",
  });
});

test("report validation checks code format without duplicating the required error", () => {
  assert.deepEqual(validateReportForm({ ...validReport, code: "12 invalid" }), {
    code: "报表编码仅允许大写字母、数字、下划线和中划线，且需以字母开头",
  });
  assert.deepEqual(validateReportForm({ ...validReport, code: "  rpt_pay_daily  " }), {});
});

test("report validation maps malformed optional dates to their fields", () => {
  assert.deepEqual(validateReportForm({
    ...validReport,
    effectiveDate: "2025/06/17",
    expireDate: "2025/06/18",
  }), {
    effectiveDate: "生效日期必须使用 yyyy-mm-dd",
    expireDate: "失效日期必须使用 yyyy-mm-dd",
  });
});

test("report validation associates reversed valid date ranges with the expiry field", () => {
  assert.deepEqual(validateReportForm({
    ...validReport,
    effectiveDate: "2025-06-17",
    expireDate: "2025-06-16",
  }), {
    expireDate: "失效日期不能早于生效日期",
  });
});

test("report API validation errors map only allow-listed fields to safe persistent messages", () => {
  const error = Object.assign(new Error("Report validation failed"), {
    status: 422,
    payload: {
      error: {
        code: "REPORT_VALIDATION_FAILED",
        details: [
          { field: "ownerDept", message: "ownerDept is not allowed: internal value" },
          { field: "privateColumn", message: "do not render server details" },
        ],
      },
    },
  });

  assert.deepEqual(mapReportApiFieldErrors(error), {
    fieldErrors: { ownerDept: "服务端校验未通过，请检查此字段。" },
    hasUnmappedErrors: true,
  });
});

test("report duplicate-code conflicts remain attached to the editable code field", () => {
  const error = Object.assign(new Error("Report already exists: RPT_PRIVATE"), {
    status: 409,
    payload: { error: { code: "REPORT_ALREADY_EXISTS", message: "Report already exists" } },
  });

  assert.deepEqual(mapReportApiFieldErrors(error), {
    fieldErrors: { code: "该报表编码已存在，请修改后重试。" },
    hasUnmappedErrors: false,
  });
});
