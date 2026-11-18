import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import {
  createManualCodeTable,
  deleteManualCodeTable,
  createManualCodeValue,
  deleteManualCodeValue,
  exportManualCodeTablesCsv,
  getManualCodeValue,
  getManualCodeValuePage,
  getManualCodeTables,
  getManualCodeTablePage,
  updateManualCodeTable,
  updateManualCodeTableStatus,
  updateManualCodeValue,
  updateManualCodeValueStatus,
} from '../api/manualCodeTables.ts';
import type { ManualCodeTablePage, ManualCodeValue } from '../api/manualCodeTables.ts';
import type { MockManualCodeTable } from '../data/manualCodeTables.ts';
import { getBinaryStatusValue, toast } from '../components/common/index.ts';
import { downloadCsvRows, downloadCsvContent } from '../utils/csv.ts';
import { getErrorMessage } from '../utils/ui.ts';
import { clearFormFieldErrorEntry, mapApiFormFieldErrors } from '../utils/formFieldErrorMapping.ts';

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
  [key: string]: unknown;
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

const EMPTY_CODE_VALUE_FORM: ManualCodeValueFormData = {
  code: '',
  label: '',
  description: '',
  status: 'enabled',
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

export interface ManualCodeValueFormData {
  code: string;
  label: string;
  description: string;
  status: string;
}

export interface ManualCodeValueFormModalState {
  open: boolean;
  mode: 'new' | 'edit';
  initial: ManualCodeValue | null;
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
  total: number;
  stats: ManualCodeTablePage['stats'];
  facets: ManualCodeTablePage['facets'];
  page: number;
  pageSize: number;
  setPage: React.Dispatch<React.SetStateAction<number>>;
  setPageSize: React.Dispatch<React.SetStateAction<number>>;
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
  errorFocusRevision: number;
  clearFieldError: (field: string) => void;
  openNew: () => void;
  openEdit: (item: MockManualCodeTable) => void;
  closeForm: () => void;
  submit: () => Promise<void>;
  detailItem: MockManualCodeTable | null;
  setDetailItem: React.Dispatch<React.SetStateAction<MockManualCodeTable | null>>;
  openDetail: (item: MockManualCodeTable) => void;
  closeDetail: () => void;
  codeItems: ManualCodeValue[];
  codeItemTotal: number;
  codeItemGroupTotal: number;
  codeItemPage: number;
  codeItemPageSize: number;
  setCodeItemPage: React.Dispatch<React.SetStateAction<number>>;
  setCodeItemPageSize: React.Dispatch<React.SetStateAction<number>>;
  codeItemLoading: boolean;
  codeItemError: string;
  codeItemQuery: string;
  setCodeItemQuery: React.Dispatch<React.SetStateAction<string>>;
  codeItemStatus: string;
  setCodeItemStatus: React.Dispatch<React.SetStateAction<string>>;
  loadCodeItems: () => Promise<void>;
  codeItemDetail: ManualCodeValue | null;
  setCodeItemDetail: React.Dispatch<React.SetStateAction<ManualCodeValue | null>>;
  openCodeItemDetail: (item: ManualCodeValue) => Promise<void>;
  codeItemFormModal: ManualCodeValueFormModalState;
  codeItemForm: ManualCodeValueFormData;
  setCodeItemForm: React.Dispatch<React.SetStateAction<ManualCodeValueFormData>>;
  codeItemFormErrors: ManualCodeTableFormFieldError[];
  codeItemErrorFocusRevision: number;
  clearCodeItemFormError: (field: string) => void;
  openNewCodeItem: () => void;
  openEditCodeItem: (item: ManualCodeValue) => void;
  closeCodeItemForm: () => void;
  submitCodeItem: () => Promise<void>;
  changeCodeItemStatus: (item: ManualCodeValue, status: string) => void;
  removeCodeItem: (item: ManualCodeValue) => void;
  changeStatus: (item: MockManualCodeTable, status: string) => void;
  remove: (item: MockManualCodeTable) => void;
  exportCsv: () => Promise<void>;
}

export function useManualCodeTableModule({
  active,
  query,
  requireLogin,
}: UseManualCodeTableModuleProps): UseManualCodeTableModuleResult {
  const [items, setItems] = useState<MockManualCodeTable[]>([]);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState<ManualCodeTablePage['stats']>({ total: 0, enabled: 0, disabled: 0, styleCount: 0 });
  const [facets, setFacets] = useState<ManualCodeTablePage['facets']>({
    styleTotal: 0, styles: {}, statusTotal: 0, statuses: { enabled: 0, disabled: 0 },
  });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [loading, setLoading] = useState(true);
  const requestSequence = useRef(0);
  const codeItemRequestSequence = useRef(0);
  const codeItemDetailRequestSequence = useRef(0);
  const previousFilterKey = useRef<string | null>(null);
  const previousCodeItemFilterKey = useRef<string | null>(null);
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
  const [codeItems, setCodeItems] = useState<ManualCodeValue[]>([]);
  const [codeItemTotal, setCodeItemTotal] = useState(0);
  const [codeItemGroupTotal, setCodeItemGroupTotal] = useState(0);
  const [codeItemPage, setCodeItemPage] = useState(1);
  const [codeItemPageSize, setCodeItemPageSize] = useState(20);
  const [codeItemLoading, setCodeItemLoading] = useState(false);
  const [codeItemError, setCodeItemError] = useState('');
  const [codeItemQuery, setCodeItemQuery] = useState('');
  const [codeItemStatus, setCodeItemStatus] = useState('');
  const [codeItemDetail, setCodeItemDetail] = useState<ManualCodeValue | null>(null);
  const [codeItemFormModal, setCodeItemFormModal] = useState<ManualCodeValueFormModalState>({
    open: false,
    mode: 'new',
    initial: null,
    busy: false,
  });
  const [codeItemForm, setCodeItemForm] = useState<ManualCodeValueFormData>(EMPTY_CODE_VALUE_FORM);
  const [codeItemFormErrors, setCodeItemFormErrors] = useState<ManualCodeTableFormFieldError[]>([]);
  const [codeItemErrorFocusRevision, setCodeItemErrorFocusRevision] = useState(0);
  const [form, setForm] = useState<ManualCodeTableFormData>(EMPTY_FORM);
  const [formErrors, setFormErrors] = useState<ManualCodeTableFormFieldError[]>([]);
  const [errorFocusRevision, setErrorFocusRevision] = useState(0);
  const submitInFlight = useRef(false);
  const codeItemSubmitInFlight = useRef(false);
  const clearFieldError = useCallback((field: string) => {
    setFormErrors((current) => clearFormFieldErrorEntry(current, field));
  }, []);
  const clearCodeItemFormError = useCallback((field: string) => {
    setCodeItemFormErrors((current) => clearFormFieldErrorEntry(current, field));
  }, []);

  const load = useCallback(async (requestedPage = page): Promise<void> => {
    const sequence = ++requestSequence.current;
    setLoading(true);
    setError('');
    try {
      const result = await getManualCodeTablePage({
        keyword: query || '',
        style: styleFilter || undefined,
        status: statusFilter || undefined,
      }, requestedPage, pageSize);
      if (sequence !== requestSequence.current) return;
      setItems(result.items.map((item) => ({ ...item, status: getBinaryStatusValue(item.status) })));
      setTotal(result.total);
      setStats(result.stats);
      setFacets(result.facets);
      if (result.page !== page) setPage(result.page);
      if (result.pageSize !== pageSize) setPageSize(result.pageSize);
    } catch (nextError: unknown) {
      if (sequence === requestSequence.current) setError(getErrorMessage(nextError, '加载码值表失败。'));
    } finally {
      if (sequence === requestSequence.current) setLoading(false);
    }
  }, [page, pageSize, query, statusFilter, styleFilter]);

  const filterKey = JSON.stringify([String(query || '').trim(), styleFilter, statusFilter]);
  useLayoutEffect(() => {
    if (!active) return;
    if (previousFilterKey.current !== filterKey) {
      previousFilterKey.current = filterKey;
      if (page !== 1) {
        setPage(1);
        return;
      }
    }
    void load();
    return () => { requestSequence.current += 1; };
  }, [active, filterKey, load, page]);

  const filteredItems = items;

  const loadCodeItems = useCallback(async (requestedPage = codeItemPage): Promise<void> => {
    const sequence = ++codeItemRequestSequence.current;
    if (!detailItem) {
      setCodeItems([]);
      setCodeItemTotal(0);
      setCodeItemGroupTotal(0);
      setCodeItemLoading(false);
      setCodeItemError('');
      return;
    }
    setCodeItemLoading(true);
    setCodeItemError('');
    try {
      const result = await getManualCodeValuePage(
        detailItem.id,
        { keyword: codeItemQuery, status: codeItemStatus || undefined },
        requestedPage,
        codeItemPageSize,
      );
      if (sequence !== codeItemRequestSequence.current) return;
      setCodeItems(result.items);
      setCodeItemTotal(result.total);
      setCodeItemGroupTotal(result.stats.total);
      if (result.page !== codeItemPage) setCodeItemPage(result.page);
      if (result.pageSize !== codeItemPageSize) setCodeItemPageSize(result.pageSize);
    } catch (nextError: unknown) {
      if (sequence === codeItemRequestSequence.current) {
        setCodeItemError(getErrorMessage(nextError, '读取码值条目失败。'));
      }
    } finally {
      if (sequence === codeItemRequestSequence.current) setCodeItemLoading(false);
    }
  }, [codeItemPage, codeItemPageSize, codeItemQuery, codeItemStatus, detailItem]);

  const openDetail = (item: MockManualCodeTable): void => {
    setCodeItemPage(1);
    setCodeItemQuery('');
    setCodeItemStatus('');
    setCodeItemDetail(null);
    setDetailItem(item);
  };

  const closeDetail = (): void => {
    codeItemRequestSequence.current += 1;
    codeItemDetailRequestSequence.current += 1;
    setDetailItem(null);
    setCodeItemDetail(null);
    setCodeItems([]);
    setCodeItemError('');
    setCodeItemLoading(false);
  };

  const openCodeItemDetail = async (item: ManualCodeValue): Promise<void> => {
    if (!detailItem) return;
    const sequence = ++codeItemDetailRequestSequence.current;
    try {
      const result = await getManualCodeValue(detailItem.id, item.id);
      if (sequence === codeItemDetailRequestSequence.current) setCodeItemDetail(result);
    } catch (nextError: unknown) {
      if (sequence === codeItemDetailRequestSequence.current) {
        toast.error(getErrorMessage(nextError, '读取码值条目详情失败。'));
      }
    }
  };

  const codeItemFilterKey = JSON.stringify([codeItemQuery.trim(), codeItemStatus]);
  useLayoutEffect(() => {
    if (!active || !detailItem) return;
    if (previousCodeItemFilterKey.current !== codeItemFilterKey) {
      previousCodeItemFilterKey.current = codeItemFilterKey;
      if (codeItemPage !== 1) {
        setCodeItemPage(1);
        return;
      }
    }
    void loadCodeItems();
    return () => { codeItemRequestSequence.current += 1; };
  }, [active, codeItemFilterKey, codeItemPage, detailItem, loadCodeItems]);

  const openNew = (): void => {
    requireLogin(() => {
      setFormErrors([]);
      setForm(EMPTY_FORM);
      setFormModal({ open: true, mode: 'new', initial: null, busy: false });
    }, 'code_table:write');
  };

  const openEdit = (item: MockManualCodeTable): void => {
    requireLogin(() => {
      closeDetail();
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

  const openNewCodeItem = (): void => {
    requireLogin(() => {
      setCodeItemFormErrors([]);
      setCodeItemForm(EMPTY_CODE_VALUE_FORM);
      setCodeItemDetail(null);
      setCodeItemFormModal({ open: true, mode: 'new', initial: null, busy: false });
    }, 'code_table:write');
  };

  const openEditCodeItem = (item: ManualCodeValue): void => {
    requireLogin(() => {
      setCodeItemFormErrors([]);
      setCodeItemDetail(null);
      setCodeItemForm({
        code: item.code,
        label: item.label,
        description: item.description || '',
        status: item.status,
      });
      setCodeItemFormModal({ open: true, mode: 'edit', initial: item, busy: false });
    }, 'code_table:write');
  };

  const closeCodeItemForm = (): void => {
    if (!codeItemFormModal.busy) {
      setCodeItemFormModal({ open: false, mode: 'new', initial: null, busy: false });
    }
  };

  const submitCodeItem = async (): Promise<void> => {
    if (!detailItem || codeItemSubmitInFlight.current || codeItemFormModal.busy) return;
    const payload = {
      code: codeItemForm.code.trim().toUpperCase(),
      label: codeItemForm.label.trim(),
      description: codeItemForm.description.trim(),
      status: codeItemForm.status,
    };
    const errors: ManualCodeTableFormFieldError[] = [];
    if (!/^[A-Z][A-Z0-9_]{0,63}$/.test(payload.code)) {
      errors.push({ field: 'code', message: '条目编码须以英文字母开头，只能包含字母、数字和下划线，长度为 1–64 位' });
    }
    if (!payload.label) errors.push({ field: 'label', message: '条目名称不能为空' });
    if (payload.label.length > 128) errors.push({ field: 'label', message: '条目名称不能超过 128 个字符' });
    if (payload.description.length > 512) errors.push({ field: 'description', message: '条目说明不能超过 512 个字符' });
    if (!['enabled', 'disabled'].includes(payload.status)) errors.push({ field: 'status', message: '状态无效' });
    if (errors.length) {
      setCodeItemFormErrors(errors);
      setCodeItemErrorFocusRevision((revision) => revision + 1);
      return;
    }
    codeItemSubmitInFlight.current = true;
    setCodeItemFormModal((current) => ({ ...current, busy: true }));
    try {
      if (codeItemFormModal.mode === 'edit' && codeItemFormModal.initial) {
        await updateManualCodeValue(detailItem.id, codeItemFormModal.initial.id, payload);
        await loadCodeItems();
      } else {
        await createManualCodeValue(detailItem.id, payload);
        setCodeItemPage(1);
        await loadCodeItems(1);
      }
      setCodeItemFormModal({ open: false, mode: 'new', initial: null, busy: false });
      toast.success(codeItemFormModal.mode === 'edit' ? '码值条目已更新' : '码值条目已新增');
    } catch (nextError: unknown) {
      setCodeItemFormErrors(mapApiFormFieldErrors(nextError, ['code', 'label', 'description', 'status']));
      setCodeItemErrorFocusRevision((revision) => revision + 1);
      setCodeItemFormModal((current) => ({ ...current, busy: false }));
    } finally {
      codeItemSubmitInFlight.current = false;
    }
  };

  const changeCodeItemStatus = (item: ManualCodeValue, status: string): void => {
    if (!detailItem) return;
    requireLogin(async () => {
      try {
        await updateManualCodeValueStatus(detailItem.id, item.id, status);
        await loadCodeItems();
        toast.success(`已${status === 'enabled' ? '启用' : '禁用'} ${item.code}`);
      } catch (nextError: unknown) {
        toast.error(getErrorMessage(nextError, '更新码值条目状态失败。'));
      }
    }, 'code_table:write');
  };

  const removeCodeItem = (item: ManualCodeValue): void => {
    if (!detailItem) return;
    requireLogin(async () => {
      try {
        await deleteManualCodeValue(detailItem.id, item.id);
        setCodeItemDetail(null);
        await loadCodeItems();
        toast.success(`已删除 ${item.code}`);
      } catch (nextError: unknown) {
        toast.error(getErrorMessage(nextError, '删除码值条目失败。'));
      }
    }, 'code_table:write');
  };

  const submit = async (): Promise<void> => {
    if (submitInFlight.current || formModal.busy) return;
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
      setErrorFocusRevision((revision) => revision + 1);
      return;
    }
    submitInFlight.current = true;
    setFormModal((current) => ({ ...current, busy: true }));
    try {
      if (formModal.mode === 'edit' && formModal.initial) {
        await updateManualCodeTable(formModal.initial.id, payload);
        await load();
      } else {
        await createManualCodeTable(payload);
        setPage(1);
        await load(1);
      }
      setFormModal({ open: false, mode: 'new', initial: null, busy: false });
      toast.success(formModal.mode === 'edit' ? '码值表已更新' : '码值表已新增');
    } catch (nextError: unknown) {
      setFormErrors(mapApiFormFieldErrors(nextError, ['tableCode', 'tableName', 'style', 'owner', 'status', 'remark']));
      setErrorFocusRevision((revision) => revision + 1);
      setFormModal((current) => ({ ...current, busy: false }));
    } finally {
      submitInFlight.current = false;
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

  const exportCsv = async (): Promise<void> => {
    try {
      const csv = await exportManualCodeTablesCsv({
        keyword: query || '',
        style: styleFilter,
        status: statusFilter,
      });
      if (csv !== null) {
        downloadCsvContent('手工码值表清单.csv', csv);
        return;
      }

      const styleMap = Object.fromEntries(MANUAL_CODE_TABLE_STYLES.map((item) => [item.value, item.label]));
      const statusMap = Object.fromEntries(
        Object.entries(MANUAL_CODE_TABLE_STATUS_META).map(([key, value]) => [key, value.label]),
      );
      const exportItems = await getManualCodeTables({
        keyword: query || '',
        style: styleFilter,
        status: statusFilter,
      });
      const rows = [
        ['表编码', '表名称', '表样式', '负责人', '状态', '说明', '更新时间'],
        ...exportItems.map((item) => [
          item.tableCode,
          item.tableName,
          styleMap[item.style] || item.style,
          item.owner,
          statusMap[item.status] || item.status,
          item.remark,
          item.updatedAt,
        ]),
      ];
      downloadCsvRows('手工码值表清单.csv', rows);
    } catch (exportError: unknown) {
      toast.error(getErrorMessage(exportError, '导出码值表失败。'));
    }
  };

  return {
    items,
    filteredItems,
    total,
    stats,
    facets,
    page,
    pageSize,
    setPage,
    setPageSize,
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
    errorFocusRevision,
    clearFieldError,
    openNew,
    openEdit,
    closeForm,
    submit,
    detailItem,
    setDetailItem,
    openDetail,
    closeDetail,
    codeItems,
    codeItemTotal,
    codeItemGroupTotal,
    codeItemPage,
    codeItemPageSize,
    setCodeItemPage,
    setCodeItemPageSize,
    codeItemLoading,
    codeItemError,
    codeItemQuery,
    setCodeItemQuery,
    codeItemStatus,
    setCodeItemStatus,
    loadCodeItems,
    codeItemDetail,
    setCodeItemDetail,
    openCodeItemDetail,
    codeItemFormModal,
    codeItemForm,
    setCodeItemForm,
    codeItemFormErrors,
    codeItemErrorFocusRevision,
    clearCodeItemFormError,
    openNewCodeItem,
    openEditCodeItem,
    closeCodeItemForm,
    submitCodeItem,
    changeCodeItemStatus,
    removeCodeItem,
    changeStatus,
    remove,
    exportCsv,
  };
}
