import { useCallback, useEffect, useMemo, useState } from "react";
import {
  createManualCodeTable,
  deleteManualCodeTable,
  getManualCodeTables,
  updateManualCodeTable,
  updateManualCodeTableStatus,
} from "../api/manualCodeTables.js";
import { toast } from "../components/common/index.js";
import { getErrorMessage } from "../utils/ui.js";

export const MANUAL_CODE_TABLE_STYLES = [
  { value: "enum", label: "标准枚举" },
  { value: "dim", label: "维度字典" },
  { value: "status", label: "状态流转" },
  { value: "map", label: "业务映射" },
  { value: "custom", label: "自定义结构" },
];

export const MANUAL_CODE_TABLE_STATUS_META = {
  active: { label: "启用", className: "st-on" },
  draft: { label: "草稿", className: "st-warn" },
  disabled: { label: "停用", className: "st-off" },
};

const EMPTY_FORM = { tableCode: "", tableName: "", style: "", owner: "", status: "active", remark: "" };

export function useManualCodeTableModule({ active, query, requireLogin }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [styleFilter, setStyleFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [formModal, setFormModal] = useState({ open: false, mode: "new", initial: null, busy: false });
  const [detailItem, setDetailItem] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [formErrors, setFormErrors] = useState([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setItems(await getManualCodeTables());
    } catch (nextError) {
      setError(getErrorMessage(nextError, "加载码值表失败。"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (active) load();
  }, [active, load]);

  const filteredItems = useMemo(() => {
    const keyword = String(query || "").trim().toLowerCase();
    return items.filter((item) => {
      if (styleFilter && item.style !== styleFilter) return false;
      if (statusFilter && item.status !== statusFilter) return false;
      return !keyword || [item.tableCode, item.tableName, item.owner, item.remark]
        .some((value) => String(value || "").toLowerCase().includes(keyword));
    });
  }, [items, query, statusFilter, styleFilter]);

  const openNew = () => requireLogin(() => {
    setFormErrors([]);
    setForm(EMPTY_FORM);
    setFormModal({ open: true, mode: "new", initial: null, busy: false });
  }, "code_table:write");

  const openEdit = (item) => requireLogin(() => {
    setDetailItem(null);
    setFormErrors([]);
    setForm({
      tableCode: item.tableCode,
      tableName: item.tableName,
      style: item.style,
      owner: item.owner || "",
      status: item.status,
      remark: item.remark || "",
    });
    setFormModal({ open: true, mode: "edit", initial: item, busy: false });
  }, "code_table:write");

  const closeForm = () => {
    if (!formModal.busy) setFormModal({ open: false, mode: "new", initial: null, busy: false });
  };

  const submit = async () => {
    const payload = {
      tableCode: form.tableCode.trim().toUpperCase(),
      tableName: form.tableName.trim(),
      style: form.style,
      owner: form.owner.trim(),
      status: form.status,
      remark: form.remark.trim(),
    };
    const errors = [];
    if (!/^[A-Z][A-Z0-9_]{1,63}$/.test(payload.tableCode)) errors.push({ field: "tableCode", message: "表编码须以大写字母开头，只能包含大写字母、数字和下划线，长度为 2–64 位" });
    if (!payload.tableName) errors.push({ field: "tableName", message: "表名称不能为空" });
    if (!payload.style) errors.push({ field: "style", message: "请选择表样式" });
    if (errors.length) {
      setFormErrors(errors);
      return;
    }
    setFormModal((current) => ({ ...current, busy: true }));
    try {
      if (formModal.mode === "edit") await updateManualCodeTable(formModal.initial.id, payload);
      else await createManualCodeTable(payload);
      await load();
      setFormModal({ open: false, mode: "new", initial: null, busy: false });
      toast.success(formModal.mode === "edit" ? "码值表已更新" : "码值表已新增");
    } catch (nextError) {
      const details = nextError?.payload?.error?.details;
      setFormErrors(Array.isArray(details) && details.length ? details : [{ field: "form", message: getErrorMessage(nextError, "保存码值表失败。") }]);
      setFormModal((current) => ({ ...current, busy: false }));
    }
  };

  const changeStatus = (item, status) => requireLogin(async () => {
    try {
      await updateManualCodeTableStatus(item.id, status);
      await load();
      toast.success(`已${status === "active" ? "启用" : "停用"} ${item.tableName}`);
    } catch (nextError) {
      toast.error(getErrorMessage(nextError, "更新码值表状态失败。"));
    }
  }, "code_table:write");

  const remove = (item) => requireLogin(async () => {
    try {
      await deleteManualCodeTable(item.id);
      await load();
      setFormModal({ open: false, mode: "new", initial: null, busy: false });
      toast.success(`已删除 ${item.tableName}`);
    } catch (nextError) {
      toast.error(getErrorMessage(nextError, "删除码值表失败。"));
    }
  }, "code_table:write");

  const exportCsv = () => {
    const styleMap = Object.fromEntries(MANUAL_CODE_TABLE_STYLES.map((item) => [item.value, item.label]));
    const statusMap = Object.fromEntries(Object.entries(MANUAL_CODE_TABLE_STATUS_META).map(([key, value]) => [key, value.label]));
    const escapeCell = (value) => `"${String(value ?? "").replaceAll("\"", "\"\"")}"`;
    const rows = [
      ["表编码", "表名称", "表样式", "负责人", "状态", "说明", "更新时间"],
      ...filteredItems.map((item) => [
        item.tableCode, item.tableName, styleMap[item.style] || item.style, item.owner,
        statusMap[item.status] || item.status, item.remark, item.updatedAt,
      ]),
    ];
    const blob = new Blob(["\uFEFF" + rows.map((row) => row.map(escapeCell).join(",")).join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "手工码值表清单.csv";
    link.click();
    URL.revokeObjectURL(url);
  };

  return {
    items, filteredItems, loading, error, load,
    styleFilter, setStyleFilter, statusFilter, setStatusFilter,
    formModal, form, setForm, formErrors, openNew, openEdit, closeForm, submit,
    detailItem, setDetailItem, changeStatus, remove, exportCsv,
  };
}
