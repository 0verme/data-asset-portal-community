import { formatDate, formatDateTime } from "../../utils/date.js";
import { RowActions, StatusBadge } from "../common/index.js";
import { Icon } from "../ui.jsx";

function MetaItem({ label, value, mono = false }) {
  return (
    <div className="indicator-detail-item">
      <div className="indicator-detail-label">{label}</div>
      <div className={`indicator-detail-value${mono ? " mono" : ""}`}>{value || "-"}</div>
    </div>
  );
}

function ReferenceChips({ items, itemKey, labelKey, mono = false, empty = "暂无引用", onRemove }) {
  if (!items.length) {
    return <div className="report-ref-empty">{empty}</div>;
  }

  return (
    <div className="report-ref-chip-list">
      {items.map((item) => (
        <span key={item[itemKey]} className={`tag tag-neutral${mono ? " mono" : ""}`}>
          <span className="report-ref-chip-text">{item[labelKey]}</span>
          {onRemove ? (
            <button
              type="button"
              className="report-ref-chip-remove"
              onClick={() => onRemove(item[itemKey])}
              aria-label={`移除 ${item[labelKey]}`}
            >
              <Icon name="close" size={11} />
            </button>
          ) : null}
        </span>
      ))}
    </div>
  );
}
export function ReportDetailDrawer({ report, open, onClose, onEdit, onDelete, canEdit = false }) {
  if (!open || !report) return null;

  return (
    <div className="indicator-detail-shell" role="presentation" onMouseDown={onClose}>
      <aside
        className="indicator-detail-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="report-detail-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="indicator-detail-head">
          <div>
            <div className="editor-title">
              <Icon name="file" size={20} color="var(--ink-2)" />
              <h2 id="report-detail-title">报表详情</h2>
            </div>
            <div className="editor-sub">{report.code}</div>
          </div>
          <button className="btn" type="button" onClick={onClose}>
            <Icon name="close" size={14} />关闭
          </button>
        </div>

        <div className="indicator-detail-body">
          <div className="form-card">
            <h3><Icon name="info" size={14} />基本信息</h3>
            <div className="indicator-detail-grid">
              <MetaItem label="报表名称" value={report.name} />
              <MetaItem label="报表别名" value={report.alias} />
              <MetaItem label="报表类型" value={report.type} />
              <MetaItem label="统计周期" value={report.statPeriod || (report.legacyFreq ? `待补充（原值：${report.legacyFreq}）` : "")} />
              <MetaItem label="主题域" value={report.domain} />
              <MetaItem label="统计口径" value={report.statCaliber || report.dateCaliberOther || report.dateCaliber || report.legacyTimeCaliber} />
              <MetaItem label="数据延迟" value={report.dataDelay || report.dataTimelinessCustom || report.dataTimeliness || "未设置"} />
              <MetaItem label="状态" value={<StatusBadge status={report.status} />} />
              <MetaItem label="生效日期" value={formatDate(report.effectiveDate)} mono />
              <MetaItem label="失效日期" value={report.expireDate ? formatDate(report.expireDate) : "长期有效"} mono />
            </div>
          </div>

          <div className="form-card">
            <h3><Icon name="book" size={14} />统计口径</h3>
            <div className="indicator-detail-grid">
              <MetaItem label="报表说明" value={report.purpose} />
              <MetaItem label="统计对象" value={report.statObject} />
              <MetaItem label="业务范围标签" value={report.businessScopeTags || report.statScope} />
              <MetaItem label="过滤条件" value={report.filterCondition} mono />
              <MetaItem label="特殊规则" value={report.specialRule} />
            </div>
          </div>

          <div className="form-card">
            <h3><Icon name="link" size={14} />关联引用</h3>
            <div className="report-detail-section">
              <div className="report-detail-subtitle">关联表</div>
              <ReferenceChips items={report.relatedTables || []} itemKey="tableName" labelKey="tableName" mono empty="暂无关联表" />
            </div>
            <div className="report-detail-section">
              <div className="report-detail-subtitle">关联指标</div>
              <ReferenceChips items={report.relatedIndicators || []} itemKey="indicatorId" labelKey="indicatorId" mono empty="暂无关联指标" />
            </div>
          </div>

          <div className="form-card">
            <h3><Icon name="user" size={14} />归属信息</h3>
            <div className="indicator-detail-grid">
              <MetaItem label="归属部门" value={report.ownerDept} />
              <MetaItem label="负责人" value={report.ownerName} />
              <MetaItem label="维护人" value={report.maintainerName} />
              <MetaItem label="备注" value={report.remark} />
              <MetaItem label="更新人" value={report.updatedBy} />
              <MetaItem label="更新时间" value={formatDateTime(report.updatedAt)} mono />
            </div>
          </div>
        </div>

        {canEdit ? <div className="indicator-detail-foot">
          <RowActions onEdit={() => onEdit(report.code)} />
          <button className="btn ghost-danger" type="button" onClick={() => onDelete(report.code)}>
            <Icon name="trash" size={14} />删除
          </button>
        </div> : null}
      </aside>
    </div>
  );
}
