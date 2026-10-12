import assert from "node:assert/strict";
import test from "node:test";

import { getTableFieldLabel, validateTableForm } from "./tableFormErrors.ts";

const validRow = {
  _key: "row-1",
  name: "order_id",
  cn: "订单编号",
  typeBase: "VARCHAR",
  typeLength: "64",
  typePrecision: "18",
  typeScale: "2",
  nullable: false,
  pk: false,
};

const validForm = {
  name: "dwm_order_detail",
  cn: "订单明细",
  domain: "交易",
  layer: "DWM",
  fields: [validRow],
};

test("table validation maps top-level and dynamic row errors to stable field paths", () => {
  const result = validateTableForm({
    ...validForm,
    name: " ",
    cn: "",
    domain: "",
    fields: [{ ...validRow, name: " ", cn: "" }],
  }, [], "");

  assert.deepEqual(result.formFields, {
    name: "请输入表英文名。",
    cn: "请输入表中文名或业务含义。",
    domain: "请选择主题域。",
    "fields.row-1.name": "请输入字段名",
    "fields.row-1.cn": "请输入字段中文注释",
  });
  assert.equal(result.fields["row-1"]?.name, "请输入字段名");
  assert.equal(result.fields["row-1"]?.cn, "请输入字段中文注释");
  assert.equal(result.list.includes("存在未填写字段名的字段。"), true);
  assert.equal(getTableFieldLabel("fields.row-1.cn", [validRow]), "字段1中文注释");
});

test("table validation keeps duplicate table and row errors attached to their fields", () => {
  const result = validateTableForm({
    ...validForm,
    fields: [validRow, { ...validRow, _key: "row-2", cn: "重复字段" }],
  }, [validForm.name], "");

  assert.equal(result.formFields["name"], "表名 dwm_order_detail 已存在。");
  assert.equal(result.formFields["fields.row-2.name"], "字段名重复");
  assert.equal(result.fields["row-2"]?.name, "字段名重复");
  assert.equal(result.list.includes("字段 order_id 重复。"), true);
  assert.equal(getTableFieldLabel("fields.row-2.name", [{ _key: "row-1" }, { _key: "row-2" }]), "字段2字段名");
});

test("type errors target the editable component that can correct each error", () => {
  const varchar = validateTableForm({
    ...validForm,
    fields: [{ ...validRow, typeLength: "0" }],
  }, [], "");
  assert.equal(varchar.formFields["fields.row-1.typeLength"], "VARCHAR 长度必须为正整数");
  assert.equal(varchar.fields["row-1"]?.typeField, "typeLength");

  const precision = validateTableForm({
    ...validForm,
    fields: [{ ...validRow, typeBase: "NUMERIC", typePrecision: "0" }],
  }, [], "");
  assert.equal(precision.formFields["fields.row-1.typePrecision"], "NUMERIC precision 必须为正整数");
  assert.equal(precision.fields["row-1"]?.typeField, "typePrecision");

  const scale = validateTableForm({
    ...validForm,
    fields: [{ ...validRow, typeBase: "NUMERIC", typeScale: "19" }],
  }, [], "");
  assert.equal(scale.formFields["fields.row-1.typeScale"], "NUMERIC scale 不能大于 precision");
  assert.equal(scale.fields["row-1"]?.typeField, "typeScale");
});

test("empty field lists and primary-key nullability expose actionable field paths", () => {
  const empty = validateTableForm({ ...validForm, fields: [] }, [], "");
  assert.equal(empty.formFields["fields"], "至少需要一个字段。");

  const nullablePrimaryKey = validateTableForm({
    ...validForm,
    fields: [{ ...validRow, pk: true, nullable: true }],
  }, [], "");
  assert.equal(nullablePrimaryKey.formFields["fields.row-1.pk"], "主键字段不能可空");
  assert.equal(nullablePrimaryKey.fields["row-1"]?.nullable, "主键字段不能可空");
  assert.equal(getTableFieldLabel("fields.row-1.pk", [validRow]), "字段1主键设置");
});