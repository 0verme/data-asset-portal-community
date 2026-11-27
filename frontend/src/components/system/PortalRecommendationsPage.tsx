import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import {
  createAdminPortalRecommendation,
  deleteAdminPortalRecommendation,
  getAdminPortalRecommendations,
  restoreAdminPortalRecommendationDefaults,
  updateAdminPortalRecommendation,
  updateAdminPortalRecommendationStatus,
  type AdminPortalRecommendationItem,
} from "../../api/hotKeywords.ts";
import { PORTAL_AI_EXAMPLE_CATEGORY } from "../../config/portalSearch.ts";
import { formatDateTime } from "../../utils/date.ts";
import { formFieldErrorEntries } from "../../utils/formFieldErrorMapping.ts";
import {
  BinaryStatusToggle,
  confirmDeleteAction,
  DangerZone,
  EmptyState,
  FormModal,
  FormSection,
  RowActions,
  StatusBadge,
  WideTableScroll,
} from "../common/index.ts";
import { Highlight, Icon } from "../ui.tsx";
import {
  Button,
  FormErrorSummary,
  FormField,
  focusFirstFormError,
  Input,
  Select,
  TablePagination,
  Textarea,
} from "../../ui/index.ts";
import { PARAM_STATUS_META } from "./constants.ts";

type RecommendationGroupFilter = "all" | "ai_example" | "hot_keyword";

interface RecommendationFormState {
  itemType: "ai_example" | "hot_keyword";
  category: string;
  keyword: string;
  sortOrder: string;
  status: "enabled" | "disabled";
}

interface RecommendationFieldError {
  field: string;
  message: string;
}

const RECOMMENDATION_FORM_ID = "portal-recommendation-form";

const RECOMMENDATION_FIELD_LABELS: Readonly<Record<string, string>> = {
  itemType: "推荐类型",
  category: "关联搜索分类",
  keyword: "推荐内容",
  sortOrder: "排序值",
  status: "状态",
};

const HOT_KEYWORD_CATEGORY_OPTIONS: readonly { value: string; label: string }[] = [
  { value: "all", label: "全部范围（通用）" },
  { value: "asset", label: "数据仓库 / 资产" },
  { value: "system", label: "上游系统" },
  { value: "field", label: "字段映射" },
  { value: "root", label: "词根管理" },
  { value: "metric", label: "指标维护" },
  { value: "report", label: "报表资产" },
  { value: "api", label: "API 资产" },
  { value: "downstream", label: "下游推送" },
  { value: "code_table", label: "手工码表" },
];

const CATEGORY_LABELS: Readonly<Record<string, string>> = {
  [PORTAL_AI_EXAMPLE_CATEGORY]: "AI 问答",
  all: "全部范围",
  asset: "资产",
  system: "系统",
  field: "字段",
  root: "词根",
  metric: "指标",
  report: "报表",
  api: "API",
  downstream: "下游推送",
  lineage: "血缘分析",
  code_table: "码值表",
};

export interface PortalRecommendationsPageProps {
  query?: string | undefined;
  canEdit: boolean;
}

export function PortalRecommendationsPage({
  query = "",
  canEdit,
}: PortalRecommendationsPageProps) {
  const [items, setItems] = useState<AdminPortalRecommendationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [restoring, setRestoring] = useState(false);
  const [groupFilter, setGroupFilter] = useState<RecommendationGroupFilter>("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const [modal, setModal] = useState<{
    open: boolean;
    mode: "new" | "edit";
    initial: AdminPortalRecommendationItem | null;
    busy: boolean;
  }>({
    open: false,
    mode: "new",
    initial: null,
    busy: false,
  });

  const [form, setForm] = useState<RecommendationFormState>({
    itemType: "ai_example",
    category: "all",
    keyword: "",
    sortOrder: "10",
    status: "enabled",
  });
  const [formErrors, setFormErrors] = useState<RecommendationFieldError[]>([]);
  const [focusRevision, setFocusRevision] = useState(0);
  const fieldErrors = useMemo(() => formFieldErrorEntries(formErrors), [formErrors]);
  const formRef = useRef<HTMLDivElement>(null);
  const previousFocusRevision = useRef(focusRevision);

  useLayoutEffect(() => {
    if (previousFocusRevision.current === focusRevision) return;
    previousFocusRevision.current = focusRevision;
    focusFirstFormError(formRef.current, fieldErrors, "auto");
  }, [fieldErrors, focusRevision]);

  const loadItems = async () => {
    setLoading(true);
    setError("");
    try {
      const loaded = await getAdminPortalRecommendations();
      setItems(loaded);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "读取首页推荐配置失败。");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadItems();
  }, []);

  const aiExampleCount = useMemo(
    () => items.filter((item) => item.category === PORTAL_AI_EXAMPLE_CATEGORY).length,
    [items],
  );
  const hotKeywordCount = useMemo(
    () => items.filter((item) => item.category !== PORTAL_AI_EXAMPLE_CATEGORY).length,
    [items],
  );

  const normalizedQuery = query.trim().toLowerCase();
  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      if (groupFilter === "ai_example" && item.category !== PORTAL_AI_EXAMPLE_CATEGORY) {
        return false;
      }
      if (groupFilter === "hot_keyword" && item.category === PORTAL_AI_EXAMPLE_CATEGORY) {
        return false;
      }
      if (!normalizedQuery) return true;
      const categoryLabel = CATEGORY_LABELS[item.category] || item.category;
      const typeLabel = item.category === PORTAL_AI_EXAMPLE_CATEGORY ? "AI 示例问题" : "热门搜索词";
      return [item.keyword, item.category, categoryLabel, typeLabel].some((val) =>
        String(val || "").toLowerCase().includes(normalizedQuery),
      );
    });
  }, [groupFilter, items, normalizedQuery]);

  const pagedItems = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filteredItems.slice(start, start + pageSize);
  }, [filteredItems, page, pageSize]);

  const clearFieldError = (field: string) => {
    setFormErrors((current) => current.filter((entry) => entry.field !== field));
  };

  const openNew = (defaultType?: "ai_example" | "hot_keyword") => {
    const nextType =
      defaultType ?? (groupFilter === "hot_keyword" ? "hot_keyword" : "ai_example");
    const matching = items.filter((item) =>
      nextType === "ai_example"
        ? item.category === PORTAL_AI_EXAMPLE_CATEGORY
        : item.category !== PORTAL_AI_EXAMPLE_CATEGORY,
    );
    const maxSort = matching.reduce((acc, item) => Math.max(acc, item.sortOrder), 0);
    setForm({
      itemType: nextType,
      category: nextType === "ai_example" ? PORTAL_AI_EXAMPLE_CATEGORY : "all",
      keyword: "",
      sortOrder: String(maxSort + 10),
      status: "enabled",
    });
    setFormErrors([]);
    setNotice("");
    setModal({ open: true, mode: "new", initial: null, busy: false });
  };

  const openEdit = (item: AdminPortalRecommendationItem) => {
    const isAi = item.category === PORTAL_AI_EXAMPLE_CATEGORY;
    setForm({
      itemType: isAi ? "ai_example" : "hot_keyword",
      category: isAi ? "all" : item.category,
      keyword: item.keyword,
      sortOrder: String(item.sortOrder),
      status: item.status,
    });
    setFormErrors([]);
    setNotice("");
    setModal({ open: true, mode: "edit", initial: item, busy: false });
  };

  const handleSubmit = async () => {
    const nextErrors: RecommendationFieldError[] = [];
    const trimmedKeyword = form.keyword.trim();
    if (!trimmedKeyword) {
      nextErrors.push({
        field: "keyword",
        message:
          form.itemType === "ai_example"
            ? "请输入 AI 示例问题内容"
            : "请输入热门搜索词",
      });
    } else if (trimmedKeyword.length > 255) {
      nextErrors.push({
        field: "keyword",
        message: "推荐内容最多 255 个字符",
      });
    }

    const parsedSort = Number(form.sortOrder.trim());
    if (!form.sortOrder.trim() || !Number.isInteger(parsedSort) || parsedSort < -9999 || parsedSort > 99999) {
      nextErrors.push({
        field: "sortOrder",
        message: "排序值需为 -9999 到 99999 之间的整数",
      });
    }

    const effectiveCategory =
      form.itemType === "ai_example"
        ? PORTAL_AI_EXAMPLE_CATEGORY
        : form.category || "all";

    if (nextErrors.length > 0) {
      setFormErrors(nextErrors);
      setFocusRevision((rev) => rev + 1);
      return;
    }

    setModal((current) => ({ ...current, busy: true }));
    setFormErrors([]);
    try {
      if (modal.mode === "edit" && modal.initial) {
        await updateAdminPortalRecommendation(modal.initial.id, {
          keyword: trimmedKeyword,
          category: effectiveCategory,
          sortOrder: parsedSort,
          status: form.status,
        });
        setNotice("首页推荐项已更新。");
      } else {
        await createAdminPortalRecommendation({
          keyword: trimmedKeyword,
          category: effectiveCategory,
          sortOrder: parsedSort,
          status: form.status,
        });
        setNotice("首页推荐项已创建。");
      }
      setModal({ open: false, mode: "new", initial: null, busy: false });
      await loadItems();
    } catch (err: unknown) {
      setModal((current) => ({ ...current, busy: false }));
      setFormErrors([
        {
          field: "keyword",
          message: err instanceof Error ? err.message : "保存失败，请检查输入内容。",
        },
      ]);
      setFocusRevision((rev) => rev + 1);
    }
  };

  const handleToggleStatus = async (
    item: AdminPortalRecommendationItem,
    nextStatus: "enabled" | "disabled",
  ) => {
    setError("");
    setNotice("");
    try {
      await updateAdminPortalRecommendationStatus(item.id, nextStatus);
      setNotice(`已${nextStatus === "enabled" ? "启用" : "停用"}“${item.keyword}”。`);
      await loadItems();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "更新状态失败。");
    }
  };

  const handleDelete = async (item: AdminPortalRecommendationItem) => {
    setModal((current) => ({ ...current, busy: true }));
    setError("");
    setNotice("");
    try {
      await deleteAdminPortalRecommendation(item.id);
      setModal({ open: false, mode: "new", initial: null, busy: false });
      setNotice(`已删除“${item.keyword}”。`);
      await loadItems();
    } catch (err: unknown) {
      setModal((current) => ({ ...current, busy: false }));
      setFormErrors([
        {
          field: "keyword",
          message: err instanceof Error ? err.message : "删除失败，请稍后重试。",
        },
      ]);
      setFocusRevision((rev) => rev + 1);
    }
  };

  const handleRestoreDefaults = async () => {
    setRestoring(true);
    setError("");
    setNotice("");
    try {
      const scope =
        groupFilter === "ai_example"
          ? "ai_example"
          : groupFilter === "hot_keyword"
            ? "hot_keyword"
            : "all";
      const updated = await restoreAdminPortalRecommendationDefaults(scope);
      setItems(updated);
      setNotice("已恢复默认推荐项并启用。");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "恢复默认推荐项失败。");
    } finally {
      setRestoring(false);
    }
  };

  if (loading) {
    return (
      <div className="state-card" role="status" aria-live="polite">
        <div className="state-spinner" aria-hidden="true"></div>
        <h4>加载首页推荐配置</h4>
        <p>正在加载当前子页面所需数据。</p>
      </div>
    );
  }

  return (
    <div className="system-page portal-recommendations-page">
      <div className="page-head">
        <div>
          <div className="page-title">
            <span className="pt-code">PORTAL</span>首页推荐配置
          </div>
          <div className="page-sub">
            共 <b>{filteredItems.length}</b> 条推荐项
            {query ? <>，匹配 “{query}”</> : null}
            ，维护门户首页的 AI 示例问题与热门搜索词。
          </div>
        </div>
        {canEdit ? (
          <div className="head-actions">
            <Button
              className="btn"
              variant="secondary"
              type="button"
              disabled={restoring}
              onClick={() => void handleRestoreDefaults()}
            >
              {restoring ? "正在恢复…" : "恢复默认推荐"}
            </Button>
            <Button
              className="btn primary"
              variant="primary"
              type="button"
              onClick={() => openNew()}
            >
              <Icon name="plus" size={15} />
              {groupFilter === "hot_keyword" ? "新增热门搜索词" : "新增推荐项"}
            </Button>
          </div>
        ) : null}
      </div>

      {!canEdit ? (
        <div className="rag-config-message" role="status">
          当前账号仅具读取权限，无法修改首页推荐配置。
        </div>
      ) : null}
      {error ? (
        <div className="rag-config-error" role="alert">
          {error}
        </div>
      ) : null}
      {notice ? (
        <div className="rag-config-message" role="status">
          {notice}
        </div>
      ) : null}

      <div className="system-split">
        <div className="system-panel system-panel-nav">
          <div className="system-panel-head">
            <h3>
              <Icon name="search" size={14} />
              推荐类型
            </h3>
          </div>
          <div className="system-category-list">
            <button
              type="button"
              className={`system-category-item${groupFilter === "all" ? " active" : ""}`}
              onClick={() => {
                setGroupFilter("all");
                setPage(1);
              }}
            >
              <div>
                <div className="system-category-name">全部推荐</div>
                <div className="system-category-code">AI 示例与热门搜索词</div>
              </div>
              <span className="system-category-count">{items.length}</span>
            </button>
            <button
              type="button"
              className={`system-category-item${groupFilter === "ai_example" ? " active" : ""}`}
              onClick={() => {
                setGroupFilter("ai_example");
                setPage(1);
              }}
            >
              <div>
                <div className="system-category-name">✦ 问 AI 示例问题</div>
                <div className="system-category-code">搜索框轮播与示例问题</div>
              </div>
              <span className="system-category-count">{aiExampleCount}</span>
            </button>
            <button
              type="button"
              className={`system-category-item${groupFilter === "hot_keyword" ? " active" : ""}`}
              onClick={() => {
                setGroupFilter("hot_keyword");
                setPage(1);
              }}
            >
              <div>
                <div className="system-category-name">↑ 热门搜索词</div>
                <div className="system-category-code">首页快捷搜索词</div>
              </div>
              <span className="system-category-count">{hotKeywordCount}</span>
            </button>
          </div>
        </div>

        <div className="system-panel system-panel-main">
          {!filteredItems.length ? (
            <EmptyState
              title="暂无首页推荐项"
              desc={
                query
                  ? "没有匹配的推荐内容，试试调整搜索关键字。"
                  : "可以新增 AI 示例问题或热门搜索词，或点击上方“恢复默认推荐”。"
              }
              actionText={canEdit && !query ? "新增推荐项" : ""}
              onAction={canEdit && !query ? () => openNew() : undefined}
            />
          ) : (
            <div className="tbl-wrap">
              <WideTableScroll ariaLabel="首页推荐配置表格">
                <table className="dt mobile-card-table">
                  <thead>
                    <tr>
                      <th style={{ width: 84 }}>排序</th>
                      <th style={{ width: 130 }}>推荐类型</th>
                      <th>推荐内容</th>
                      <th style={{ width: 120 }}>适用范围</th>
                      <th style={{ width: 96 }}>状态</th>
                      <th style={{ width: 164 }}>更新时间</th>
                      <th style={{ width: 180, textAlign: "right" }}>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagedItems.map((item) => {
                      const isAiExample = item.category === PORTAL_AI_EXAMPLE_CATEGORY;
                      return (
                        <tr key={item.id}>
                          <td data-label="排序" className="mono">
                            {item.sortOrder}
                          </td>
                          <td data-label="推荐类型">
                            <span>
                              {isAiExample ? "✦ AI 示例问题" : "↑ 热门搜索词"}
                            </span>
                          </td>
                          <td data-label="推荐内容">
                            <Highlight text={item.keyword} q={query} />
                          </td>
                          <td data-label="适用范围">
                            <span>{CATEGORY_LABELS[item.category] || item.category}</span>
                          </td>
                          <td data-label="状态">
                            <StatusBadge status={item.status} metaMap={PARAM_STATUS_META} />
                          </td>
                          <td data-label="更新时间" className="mono">
                            {formatDateTime(item.updatedAt || item.createdAt)}
                          </td>
                          <td
                            data-label=""
                            className="mobile-card-actions"
                            style={{ textAlign: "right" }}
                          >
                            {canEdit ? (
                              <RowActions
                                onEdit={() => openEdit(item)}
                                toggle={{
                                  enabled: item.status === "enabled",
                                  label: item.keyword,
                                  onToggle: () =>
                                    void handleToggleStatus(
                                      item,
                                      item.status === "enabled" ? "disabled" : "enabled",
                                    ),
                                }}
                              />
                            ) : null}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </WideTableScroll>
            </div>
          )}

          <TablePagination
            ariaLabel="首页推荐配置分页"
            page={page}
            pageSize={pageSize}
            total={filteredItems.length}
            onPageChange={setPage}
            onPageSizeChange={(nextSize) => {
              setPage(1);
              setPageSize(nextSize);
            }}
          />
        </div>
      </div>

      <FormModal
        open={modal.open}
        title={modal.mode === "edit" ? "编辑首页推荐项" : "新增首页推荐项"}
        subtitle={
          modal.mode === "edit"
            ? `正在编辑：${modal.initial?.keyword || "-"}`
            : "创建新的首页推荐项"
        }
        icon="search"
        onClose={() =>
          !modal.busy && setModal({ open: false, mode: "new", initial: null, busy: false })
        }
        onSubmit={() => void handleSubmit()}
        submitText={modal.mode === "edit" ? "保存修改" : "创建"}
        busy={modal.busy}
      >
        <div id={RECOMMENDATION_FORM_ID} ref={formRef}>
          <FormErrorSummary
            formId={RECOMMENDATION_FORM_ID}
            errors={fieldErrors}
            getFieldLabel={(field) => RECOMMENDATION_FIELD_LABELS[field] || "表单内容"}
          />
          <FormSection title="推荐项配置">
            <div className="form-grid">
              <FormField
                className={form.itemType === "hot_keyword" ? "fl" : "fl full"}
                formId={RECOMMENDATION_FORM_ID}
                name="itemType"
                label="推荐类型"
                error={fieldErrors["itemType"]}
              >
                <Select<string>
                  aria-label="推荐类型"
                  className="inp"
                  items={[
                    { label: "✦ 问 AI 示例问题", value: "ai_example" },
                    { label: "↑ 热门搜索词", value: "hot_keyword" },
                  ]}
                  value={form.itemType}
                  onValueChange={(value) => {
                    const nextType = value === "hot_keyword" ? "hot_keyword" : "ai_example";
                    clearFieldError("itemType");
                    setForm((prev) => ({
                      ...prev,
                      itemType: nextType,
                      category:
                        nextType === "ai_example"
                          ? PORTAL_AI_EXAMPLE_CATEGORY
                          : prev.category === PORTAL_AI_EXAMPLE_CATEGORY
                            ? "all"
                            : prev.category || "all",
                    }));
                  }}
                />
              </FormField>

              {form.itemType === "hot_keyword" ? (
                <FormField
                  className="fl"
                  formId={RECOMMENDATION_FORM_ID}
                  name="category"
                  label="适用范围"
                  error={fieldErrors["category"]}
                >
                  <Select<string>
                    aria-label="关联搜索分类"
                    className="inp"
                    items={[...HOT_KEYWORD_CATEGORY_OPTIONS]}
                    value={
                      form.category === PORTAL_AI_EXAMPLE_CATEGORY
                        ? "all"
                        : form.category || "all"
                    }
                    onValueChange={(value) => {
                      clearFieldError("category");
                      setForm((prev) => ({ ...prev, category: value || "all" }));
                    }}
                  />
                </FormField>
              ) : null}

              <FormField
                className="fl full"
                formId={RECOMMENDATION_FORM_ID}
                name="keyword"
                label={form.itemType === "ai_example" ? "AI 示例问题" : "热门搜索词"}
                error={fieldErrors["keyword"]}
              >
                {form.itemType === "ai_example" ? (
                  <Textarea
                    aria-label="推荐内容"
                    className={`ta${fieldErrors["keyword"] ? " invalid" : ""}`}
                    value={form.keyword}
                    onChange={(event) => {
                      clearFieldError("keyword");
                      setForm((prev) => ({ ...prev, keyword: event.target.value }));
                    }}
                    placeholder="例如：销售额怎么算？口径是什么，从哪张表出？"
                  />
                ) : (
                  <Input
                    aria-label="推荐内容"
                    className={`inp${fieldErrors["keyword"] ? " invalid" : ""}`}
                    value={form.keyword}
                    onChange={(event) => {
                      clearFieldError("keyword");
                      setForm((prev) => ({ ...prev, keyword: event.target.value }));
                    }}
                    placeholder="例如：资产、DWS_TRADE_SALES_STAT_1D"
                  />
                )}
              </FormField>

              <FormField
                className="fl"
                formId={RECOMMENDATION_FORM_ID}
                name="sortOrder"
                label="排序值（越小越靠前）"
                error={fieldErrors["sortOrder"]}
              >
                <Input
                  aria-label="排序值"
                  className={`inp mono${fieldErrors["sortOrder"] ? " invalid" : ""}`}
                  value={form.sortOrder}
                  onChange={(event) => {
                    clearFieldError("sortOrder");
                    setForm((prev) => ({ ...prev, sortOrder: event.target.value }));
                  }}
                  placeholder="例如：10"
                />
              </FormField>

              <FormField
                className="fl"
                formId={RECOMMENDATION_FORM_ID}
                name="status"
                label="状态"
                error={fieldErrors["status"]}
              >
                <div role="group" aria-label="状态">
                  <BinaryStatusToggle
                    mode="status"
                    value={form.status}
                    className="system-status-seg"
                    onChange={(value) => {
                      clearFieldError("status");
                      const normalized =
                        typeof value === "boolean"
                          ? value
                            ? "enabled"
                            : "disabled"
                          : value === "disabled"
                            ? "disabled"
                            : "enabled";
                      setForm((prev) => ({ ...prev, status: normalized }));
                    }}
                  />
                </div>
              </FormField>
            </div>
          </FormSection>

          {modal.mode === "edit" && modal.initial ? (
            <DangerZone
              description="删除后门户首页将不再展示该推荐项；若只是临时下线，建议优先禁用。"
              actions={[
                {
                  key: "delete-recommendation",
                  label: "删除推荐项",
                  icon: "trash",
                  danger: true,
                  onClick: async () => {
                    if (
                      modal.initial &&
                      (await confirmDeleteAction({
                        name: modal.initial.keyword,
                        typeLabel:
                          modal.initial.category === PORTAL_AI_EXAMPLE_CATEGORY
                            ? "AI 示例问题"
                            : "热门搜索词",
                        impact: "删除后门户首页将不再展示该推荐项。",
                      }))
                    ) {
                      await handleDelete(modal.initial);
                    }
                  },
                },
              ]}
            />
          ) : null}
        </div>
      </FormModal>
    </div>
  );
}
