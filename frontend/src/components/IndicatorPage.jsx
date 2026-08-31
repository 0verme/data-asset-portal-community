
import { INDICATOR_DIMENSION_OPTIONS } from "../data/indicators.js";
import { formatDate, formatDateTime } from "../utils/date.js";
import { ActionErrorBanner, CardGridView, EmptyState, GroupView, RowActions, StatusBadge, ViewModeSwitcher } from "./common/index.js";
import { Highlight, Icon, initial } from "./ui.jsx";

const DIMENSION_ORDER = ["prd", "mem", "ord", "str", "inv", "mkt", "ful", "svc"];

const DIMENSION_META = {
  prd: { label: "商品维度", code: "PRD" },
  mem: { label: "会员维度", code: "MEM" },
  ord: { label: "交易维度", code: "ORD" },
  str: { label: "门店维度", code: "STR" },
  inv: { label: "库存维度", code: "INV" },
  mkt: { label: "营销维度", code: "MKT" },
  ful: { label: "履约维度", code: "FUL" },
  svc: { label: "售后维度", code: "SVC" },
};

function isPresent(value) {
  return value !== undefined && value !== null && String(value).trim() !== "";
}

function displayValue(value) {
  return isPresent(value) ? value : "-";
}

function DimensionBadge({ dimension }) {
  const meta = DIMENSION_META[dimension] || { label: dimension || "-", code: "--" };
  return (
    <span className="tag tag-neutral">
      <span className="indicator-dim-code">{meta.code}</span>
      {meta.label}
    </span>
  );
}

function DetailItem({ label, value, type = "text", full = false, fallback = false }) {
  if (!fallback && !isPresent(value)) return null;
  return (
    <div className={"indicator-detail-item" + (full ? " full" : "")}>
      <div className="indicator-detail-label">{label}</div>
      <div className={"indicator-detail-value" + (type === "mono" ? " mono" : "")}>{displayValue(value)}</div>
    </div>
  );
}

function getAdditionalFields(indicator) {
  const knownKeys = new Set([
    "id",
    "name",
    "meaning",
    "resultTableName",
    "resultFieldName",
    "dimension",
    "caliber",
    "path",
    "status",
    "registrar",
    "registeredAt",
  ]);
  const labelMap = {
    englishName: "英文名",
    enName: "英文名",
    tags: "标签",
    tag: "标签",
    source: "来源",
    sourceSystem: "来源系统",
    remark: "备注",
    remarks: "备注",
    createdAt: "创建时间",
    updatedAt: "更新时间",
  };

  return Object.entries(indicator || {})
    .filter(([key, value]) => !knownKeys.has(key) && isPresent(value))
    .map(([key, value]) => ({
      key,
      label: labelMap[key] || key,
      value: Array.isArray(value) ? value.join("、") : key === "createdAt" || key === "updatedAt" ? formatDateTime(value) : String(value),
    }));
}

export function MetricDetailDrawer({ indicator, open, onClose }) {
  if (!open || !indicator) return null;
  const additionalFields = getAdditionalFields(indicator);

  return (
    <div className="indicator-detail-shell" role="presentation" onMouseDown={onClose}>
      <aside
        className="indicator-detail-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="indicator-detail-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="indicator-detail-head">
          <div>
            <div className="editor-title">
              <Icon name="eye" size={20} color="var(--ink-2)" />
              <h2 id="indicator-detail-title">指标详情</h2>
            </div>
            <div className="editor-sub">查看该指标的完整登记信息</div>
          </div>
          <button className="btn" type="button" onClick={onClose} aria-label="关闭指标详情">
            <Icon name="close" size={14} />关闭
          </button>
        </div>

        <div className="indicator-detail-body">
          <div className="form-card">
            <h3><Icon name="hash" size={14} />基本信息</h3>
            <div className="indicator-detail-grid">
              <DetailItem label="指标 ID" value={indicator.id} type="mono" />
              <DetailItem label="指标中文名" value={indicator.name} />
              <DetailItem label="登记人" value={indicator.registrar} />
              <DetailItem label="登记日期" value={formatDate(indicator.registeredAt)} type="mono" />
            </div>
          </div>

          <div className="form-card">
            <h3><Icon name="layers" size={14} />维度与状态</h3>
            <div className="indicator-detail-grid">
              <div className="indicator-detail-item">
                <div className="indicator-detail-label">指标维度</div>
                <div className="indicator-detail-value"><DimensionBadge dimension={indicator.dimension} /></div>
              </div>
              <div className="indicator-detail-item">
                <div className="indicator-detail-label">状态</div>
                <div className="indicator-detail-value"><StatusBadge status={indicator.status} /></div>
              </div>
            </div>
          </div>

          <div className="form-card">
            <h3><Icon name="info" size={14} />口径信息</h3>
            <div className="indicator-detail-grid">
              <DetailItem label="指标含义" value={indicator.meaning} full fallback />
              <DetailItem label="结果表" value={indicator.resultTableName} type="mono" fallback />
              <DetailItem label="结果字段" value={indicator.resultFieldName} type="mono" fallback />
              <DetailItem label="指标口径" value={indicator.caliber} fallback />
              <DetailItem label="指标路径" value={indicator.path} type="mono" full fallback />
            </div>
          </div>

          {additionalFields.length ? (
            <div className="form-card">
              <h3><Icon name="book" size={14} />扩展信息</h3>
              <div className="indicator-detail-grid">
                {additionalFields.map((field) => (
                  <DetailItem
                    key={field.key}
                    label={field.label}
                    value={field.value}
                    full={String(field.value).length > 42}
                  />
                ))}
              </div>
            </div>
          ) : null}
        </div>

        <div className="indicator-detail-foot">
          <button className="btn" type="button" onClick={onClose}>
            <Icon name="close" size={14} />关闭
          </button>
        </div>
      </aside>
    </div>
  );
}

function buildFilterChips(filter, query) {
  const chips = [];
  const dimensionMeta = INDICATOR_DIMENSION_OPTIONS.find((item) => item.value === filter.dimension);

  if (filter.dimension && filter.dimension !== "all" && dimensionMeta) {
    chips.push({ key: "dimension", label: `维度：${dimensionMeta.label}` });
  }
  if (filter.status && filter.status !== "all") {
    chips.push({ key: "status", label: `状态：${filter.status === "enabled" ? "启用" : "停用"}` });
  }
  if (query) {
    chips.push({ key: "query", label: `搜索：${query}` });
  }
  return chips;
}

function IndicatorFilterBar({ filter, query, onClearDimension, onClearStatus, onClearQuery, onReset }) {
  const chips = buildFilterChips(filter, query);

  if (!chips.length) return null;

  return (
    <div className="filter-bar">
      <span className="fb-label">筛选</span>
      {chips.map((item) => (
        <span key={item.key} className="chip-active">
          {item.label}
          <button
            type="button"
            onClick={
              item.key === "dimension"
                ? onClearDimension
                : item.key === "status"
                  ? onClearStatus
                  : onClearQuery
            }
          >
            <Icon name="close" size={12} />
          </button>
        </span>
      ))}
      <button className="clear-all" type="button" onClick={onReset}>清除全部</button>
    </div>
  );
}

function IndicatorTable({ indicators, query, pendingIds = [], canEdit, onView, onEdit, onToggleStatus }) {
  if (!indicators.length) return <EmptyState title="没有匹配的指标" desc="试着调整搜索词或筛选条件。" />;

  return (
    <div className="tbl-wrap indicator-tbl">
      <table className="dt mobile-card-table">
        <thead>
          <tr>
            <th style={{ width: 148 }}>指标 ID</th>
            <th>指标中文名 / 含义</th>
            <th style={{ width: 140 }}>维度</th>
            <th style={{ width: 250 }}>指标口径 / 指标路径</th>
            <th style={{ width: 96 }}>状态</th>
            <th style={{ width: 96 }}>登记人</th>
            <th style={{ width: 118 }}>登记日期</th>
            <th style={{ width: 220, textAlign: "right" }}>操作</th>
          </tr>
        </thead>
        <tbody>
          {indicators.map((item) => {
            const pending = pendingIds.includes(item.id);
            return (
              <tr key={item.id}>
                <td data-label="">
                  <div className="indicator-id-cell">
                    <Icon name="hash" size={14} color="var(--ink-3)" />
                    <span className="indicator-id mono"><Highlight text={item.id} q={query} /></span>
                  </div>
                </td>
                <td data-label="指标含义">
                  <button className="indicator-summary-btn" type="button" onClick={() => onView(item.id)}>
                    <span className="indicator-name"><Highlight text={item.name} q={query} /></span>
                    <span className="indicator-meaning"><Highlight text={item.meaning} q={query} /></span>
                  </button>
                </td>
                <td data-label="维度"><DimensionBadge dimension={item.dimension} /></td>
                <td data-label="口径 / 路径">
                  <div className="indicator-caliber"><Highlight text={displayValue(item.caliber)} q={query} /></div>
                  <div className="indicator-path mono"><Highlight text={displayValue(item.path)} q={query} /></div>
                </td>
                <td data-label="状态"><StatusBadge status={item.status} /></td>
                <td data-label="登记人">{item.registrar}</td>
                <td data-label="登记日期" className="mono indicator-date">{formatDate(item.registeredAt)}</td>
                <td data-label="" className="mobile-card-actions" style={{ textAlign: "right" }}>
                  <RowActions
                    disabled={pending}
                    onView={() => onView(item.id)}
                    onEdit={canEdit ? () => onEdit(item.id) : undefined}
                    toggle={canEdit ? {
                      enabled: item.status === "enabled",
                      label: item.id,
                      onToggle: () => onToggleStatus(item),
                    } : undefined}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function IndicatorCardLayout({ indicators, query, onView }) {
  return (
    <CardGridView
      items={indicators}
      getKey={(item) => item.id}
      onItemClick={(item) => onView(item.id)}
      renderBadges={(item) => (
        <>
          <DimensionBadge dimension={item.dimension} />
          <StatusBadge status={item.status} />
        </>
      )}
      renderTitle={(item) => <Highlight text={item.name} q={query} />}
      renderSubtitle={(item) => <Highlight text={item.id} q={query} />}
      renderDesc={(item) => item.meaning}
      renderFootLeft={(item) => (
        <div className="t-owner" style={{ fontSize: 12.5 }}>
          <span className="mini-av" style={{ width: 22, height: 22 }}>{initial(item.registrar)}</span>
          <span style={{ color: "var(--ink-2)" }}>{item.registrar}</span>
        </div>
      )}
      renderFootMeta={(item) => (
        <span className="m"><Icon name="info" size={13} />{displayValue(item.caliber)}</span>
      )}
    />
  );
}

function IndicatorGroupLayout({ indicators, query, onView }) {
  return (
    <GroupView
      items={indicators}
      getKey={(item) => item.id}
      onItemClick={(item) => onView(item.id)}
      groupBy={(item) => item.dimension}
      groupOrder={DIMENSION_ORDER}
      renderGroupLabel={(dimension) => <DimensionBadge dimension={dimension} />}
      renderGroupCount={(count) => `${count} 个指标`}
      renderCardName={(item) => <Highlight text={item.id} q={query} />}
      renderCardBody={(item) => (
        <>
          <span><Highlight text={item.name} q={query} /></span>
          <span className="gc-owner">{item.registrar} · {displayValue(item.caliber)}</span>
        </>
      )}
    />
  );
}

export function IndicatorPage({
  indicators,
  allIndicators,
  query,
  actionError,
  filter,
  view,
  pendingIds,
  canEdit = false,
  detailIndicator,
  onChangeView,
  onNew,
  onView,
  onCloseDetail,
  onEdit,
  onToggleStatus,
  onClearActionError,
  onClearDimension,
  onClearStatus,
  onClearQuery,
  onResetFilters,
}) {
  const activeDimension = INDICATOR_DIMENSION_OPTIONS.find((item) => item.value === filter.dimension);

  return (
    <div className="indicator-page">
      <div className="page-head">
        <div>
          <div className="page-title"><span className="pt-code">指标</span>指标管理</div>
          <div className="page-sub">
            共 <b>{indicators.length}</b> 个口径指标：商品、会员、交易、门店、库存、营销、履约、售后八大维度统一维护
            {activeDimension && activeDimension.value !== "all" ? <>，当前维度 <b>{activeDimension.label}</b></> : null}
            {allIndicators.length !== indicators.length ? <>，总量 <b>{allIndicators.length}</b></> : null}
          </div>
        </div>
        <div className="head-actions">
          <ViewModeSwitcher value={view} onChange={onChangeView} />
          {canEdit ? <button className="btn primary" type="button" onClick={onNew}>
            <Icon name="plus" size={15} />新增指标
          </button> : null}
        </div>
      </div>

      <IndicatorFilterBar
        filter={filter}
        query={query}
        onClearDimension={onClearDimension}
        onClearStatus={onClearStatus}
        onClearQuery={onClearQuery}
        onReset={onResetFilters}
      />

      <ActionErrorBanner message={actionError} onClose={onClearActionError} />

      {view === "list" ? (
        <IndicatorTable
          indicators={indicators}
          query={query}
          pendingIds={pendingIds}
          canEdit={canEdit}
          onView={onView}
          onEdit={onEdit}
          onToggleStatus={onToggleStatus}
        />
      ) : !indicators.length ? (
        <EmptyState title="没有匹配的指标" desc="试着调整搜索词或筛选条件。" />
      ) : view === "card" ? (
        <IndicatorCardLayout indicators={indicators} query={query} onView={onView} />
      ) : (
        <IndicatorGroupLayout indicators={indicators} query={query} onView={onView} />
      )}

      <MetricDetailDrawer
        open={Boolean(detailIndicator)}
        indicator={detailIndicator}
        onClose={onCloseDetail}
      />
    </div>
  );
}
