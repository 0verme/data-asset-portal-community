import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  createManualCodeTable,
  deleteManualCodeTable,
  getManualCodeTables,
  updateManualCodeTable,
  updateManualCodeTableStatus,
} from '../api/manualCodeTables.ts';
import type { MockManualCodeTable } from '../data/manualCodeTables.ts';
import { getBinaryStatusValue, toast } from '../components/common/index.ts';
import { getErrorMessage, type ErrorWithPayload } from '../utils/ui.ts';

export interface ManualCodeTableStyleOption {
  value: string;
  label: string;
}

export const MANUAL_CODE_TABLE_STYLES: readonly ManualCodeTableStyleOption[] = [
  { value: 'enum', label: '标准枚举' },
  { value: 'dim', label: '维度字典' },
  { value: 'status', label: '状态流转' },
  { value: 'map', label: '业务映射' },
  { value: 'custom', label: '自定义结构' },
] as const;

export interface StatusMetaItem {
  label: string;
  className: string;
}

export const MANUAL_CODE_TABLE_STATUS_META: Readonly<Record<string, StatusMetaItem>> = Object.freeze({
  enabled: { label: '启用', className: 'st-on' },
  disabled: { label: '禁用', className: 'st-off' },
});

export interface ManualCodeTableFormData {
  tableCode: string;
  tableName: string;
  style: string;
  owner: string;
  status: string;
  remark: string;
}

const EMPTY_FORM: ManualCodeTableFormData = {
  tableCode: '',
  tableName: '',
  style: '',
  owner: '',
  status: 'enabled',
  remark: '',
};

export interface ManualCodeTableFormFieldError {
  field: string;
  message: string;
}

export interface ManualCodeTableModalState {
  open: boolean;
  mode: 'new' | 'edit';
  initial: MockManualCodeTable | null;
  busy: boolean;
}

export interface UseManualCodeTableModuleProps {
  active?: boolean | undefined;
  query?: string | undefined;
  requireLogin: (action: () => void, permission?: string) => boolean;
}

export interface UseManualCodeTableModuleResult {
  items: MockManualCodeTable[];
  filteredItems: MockManualCodeTable[];
  loading: boolean;
  error: string;
  load: () => Promise<void>;
  styleFilter: string;
  setStyleFilter: React.Dispatch<React.SetStateAction<string>>;
  statusFilter: string;
  setStatusFilter: React.Dispatch<React.SetStateAction<string>>;
  formModal: ManualCodeTableModalState;
  form: ManualCodeTableFormData;
  setForm: React.Dispatch<React.SetStateAction<ManualCodeTableFormData>>;
  formErrors: ManualCodeTableFormFieldError[];
  openNew: () => void;
  openEdit: (item: MockManualCodeTable) => void;
  closeForm: () => void;
  submit: () => Promise<void>;
  detailItem: MockManualCodeTable | null;
  setDetailItem: React.Dispatch<React.SetStateAction<MockManualCodeTable | null>>;
  changeStatus: (item: MockManualCodeTable, status: string) => void;
  remove: (item: MockManualCodeTable) => void;
  exportCsv: () => void;
}

export function useManualCodeTableModule({
  active,
  query,
  requireLogin,
}: UseManualCodeTableModuleProps): UseManualCodeTableModuleResult {
  const [items, setItems] = useState<MockManualCodeTable[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [styleFilter, setStyleFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [formModal, setFormModal] = useState<ManualCodeTableModalState>({
    open: false,
    mode: 'new',
    initial: null,
    busy: false,
  });
  const [detailItem, setDetailItem] = useState<MockManualCodeTable | null>(null);
  const [form, setForm] = useState<ManualCodeTableFormData>(EMPTY_FORM);
  const [formErrors, setFormErrors] = useState<ManualCodeTableFormFieldError[]>([]);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError('');
    try {
      const nextItems = await getManualCodeTables();
      setItems(nextItems.map((item) => ({ ...item, status: getBinaryStatusValue(item.status) })));
    } catch (nextError: unknown) {
      setError(getErrorMessage(nextError, '加载码值表失败。'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (active) load();
  }, [active, load]);

  const filteredItems = useMemo(() => {
    const keyword = String(query || '').trim().toLowerCase();
    return items.filter((item) => {
      if (styleFilter && item.style !== styleFilter) return false;
      if (statusFilter && item.status !== statusFilter) return false;
      return (
        !keyword ||
        [item.tableCode, item.tableName, item.owner, item.remark].some((value) =>
          String(value || '').toLowerCase().includes(keyword),
        )
      );
    });
  }, [items, query, statusFilter, styleFilter]);

  const openNew = (): void => {
    requireLogin(() => {
      setFormErrors([]);
      setForm(EMPTY_FORM);
      setFormModal({ open: true, mode: 'new', initial: null, busy: false });
    }, 'code_table:write');
  };

  const openEdit = (item: MockManualCodeTable): void => {
    requireLogin(() => {
      setDetailItem(null);
      setFormErrors([]);
      setForm({
        tableCode: item.tableCode,
        tableName: item.tableName,
        style: item.style,
        owner: item.owner || '',
        status: item.status,
        remark: item.remark || '',
      });
      setFormModal({ open: true, mode: 'edit', initial: item, busy: false });
    }, 'code_table:write');
  };

  const closeForm = (): void => {
    if (!formModal.busy) setFormModal({ open: false, mode: 'new', initial: null, busy: false });
  };

  const submit = async (): Promise<void> => {
    const payload = {
      tableCode: form.tableCode.trim().toUpperCase(),
      tableName: form.tableName.trim(),
      style: form.style,
      owner: form.owner.trim(),
      status: form.status,
      remark: form.remark.trim(),
    };
    const errors: ManualCodeTableFormFieldError[] = [];
    if (!/^[A-Z][A-Z0-9_]{1,63}$/.test(payload.tableCode)) {
      errors.push({
        field: 'tableCode',
        message: '表编码须以大写字母开头，只能包含大写字母、数字和下划线，长度为 2–64 位',
      });
    }
    if (!payload.tableName) errors.push({ field: 'tableName', message: '表名称不能为空' });
    if (!payload.style) errors.push({ field: 'style', message: '请选择表样式' });
    if (errors.length) {
      setFormErrors(errors);
      return;
    }
    setFormModal((current) => ({ ...current, busy: true }));
    try {
      if (formModal.mode === 'edit' && formModal.initial) {
        await updateManualCodeTable(formModal.initial.id, payload);
      } else {
        await createManualCodeTable(payload);
      }
      await load();
      setFormModal({ open: false, mode: 'new', initial: null, busy: false });
      toast.success(formModal.mode === 'edit' ? '码值表已更新' : '码值表已新增');
    } catch (nextError: unknown) {
      const errWithPayload = nextError as ErrorWithPayload | undefined;
      const details = errWithPayload?.payload?.error?.details;
      if (Array.isArray(details) && details.length) {
        setFormErrors(
          details.map((item) =>
            typeof item === 'string' ? { field: 'form', message: item } : { field: item.field || 'form', message: item.message || '' },
          ),
        );
      } else {
        setFormErrors([{ field: 'form', message: getErrorMessage(nextError, '保存码值表失败。') }]);
      }
      setFormModal((current) => ({ ...current, busy: false }));
    }
  };

  const changeStatus = (item: MockManualCodeTable, status: string): void => {
    requireLogin(async () => {
      try {
        await updateManualCodeTableStatus(item.id, status);
        await load();
        toast.success(`已${status === 'enabled' ? '启用' : '禁用'} ${item.tableName}`);
      } catch (nextError: unknown) {
        toast.error(getErrorMessage(nextError, '更新码值表状态失败。'));
      }
    }, 'code_table:write');
  };

  const remove = (item: MockManualCodeTable): void => {
    requireLogin(async () => {
      try {
        await deleteManualCodeTable(item.id);
        await load();
        setFormModal({ open: false, mode: 'new', initial: null, busy: false });
        toast.success(`已删除 ${item.tableName}`);
      } catch (nextError: unknown) {
        toast.error(getErrorMessage(nextError, '删除码值表失败。'));
      }
    }, 'code_table:write');
  };

  const exportCsv = (): void => {
    const styleMap = Object.fromEntries(MANUAL_CODE_TABLE_STYLES.map((item) => [item.value, item.label]));
    const statusMap = Object.fromEntries(
      Object.entries(MANUAL_CODE_TABLE_STATUS_META).map(([key, value]) => [key, value.label]),
    );
    const escapeCell = (value: unknown): string => `"${String(value ?? '').replaceAll('"', '""')}"`;
    const rows = [
      ['表编码', '表名称', '表样式', '负责人', '状态', '说明', '更新时间'],
      ...filteredItems.map((item) => [
        item.tableCode,
        item.tableName,
        styleMap[item.style] || item.style,
        item.owner,
        statusMap[item.status] || item.status,
        item.remark,
        item.updatedAt,
      ]),
    ];
    const blob = new Blob(['\uFEFF' + rows.map((row) => row.map(escapeCell).join(',')).join('\n')], {
      type: 'text/csv;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = '手工码值表清单.csv';
    link.click();
    URL.revokeObjectURL(url);
  };

  return {
    items,
    filteredItems,
    loading,
    error,
    load,
    styleFilter,
    setStyleFilter,
    statusFilter,
    setStatusFilter,
    formModal,
    form,
    setForm,
    formErrors,
    openNew,
    openEdit,
    closeForm,
    submit,
    detailItem,
    setDetailItem,
    changeStatus,
    remove,
    exportCsv,
  };
}
