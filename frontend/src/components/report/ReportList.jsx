import { CardGridView, EmptyState, GroupView, RowActions, StatusBadge, ViewModeSwitcher } from "../common/index.js";
import { Highlight, Icon } from "../ui.jsx";

function ReportCardLayout({ reports, query, onView, onEdit }) {
  return <CardGridView
    items={reports}
    getKey={(item) => item.code}
    onItemClick={(item) => onView(item.code)}
    renderBadges={(item) => <><span className="tag tag-neutral">{item.type || "未分类"}</span><StatusBadge status={item.status} /></>}
    renderTitle={(item) => <Highlight text={item.name} q={query} />}
    renderSubtitle={(item) => <Highlight text={item.code} q={query} />}
    renderDesc={(item) => item.purpose || "暂无用途说明"}
    renderFootLeft={(item) => <span className="t-owner">{item.ownerDept || "未归属部门"}</span>}
    renderFootMeta={(item) => <><span className="m"><Icon name="table" size={13} /><b>{item.relatedTableCount}</b> 表</span><span className="m"><Icon name="info" size={13} /><b>{item.relatedIndicatorCount}</b> 指标</span></>}
    renderFootActions={(item) => <RowActions onView={() => onView(item.code)} onEdit={() => onEdit(item.code)} />}
  />;
}

function ReportGroupLayout({ reports, query, onView }) {
  return <GroupView
    items={reports}
    getKey={(item) => item.code}
    onItemClick={(item) => onView(item.code)}
    groupBy={(item) => item.type || "未分类"}
    renderGroupLabel={(type) => <span className="tag tag-neutral">{type}</span>}
    renderGroupCount={(count) => `${count} 个报表`}
    renderCardName={(item) => <Highlight text={item.code} q={query} />}
    renderCardBody={(item) => <><span><Highlight text={item.name} q={query} /></span><span className="gc-owner">{item.ownerDept || "未归属部门"}</span></>}
  />;
}

export function ReportList({ reports, query, view, onChangeView, onView, onEdit, onNew }) {
  return (
    <div className="indicator-page">
      <div className="page-head">
        <div>
          <div className="page-title"><span className="pt-code">报表</span>报表资产</div>
          <div className="page-sub">
            共 <b>{reports.length}</b> 个报表资产{query ? <>，匹配 “{query}”</> : null}
          </div>
        </div>
        <div className="head-actions"><ViewModeSwitcher value={view} onChange={onChangeView} /><button className="btn primary" type="button" onClick={onNew}><Icon name="plus" size={15} />新增报表</button></div>
      </div>

      {!reports.length ? <EmptyState title={query ? "未找到符合条件的报表资产" : "暂无报表资产"} /> : view === "list" ? <div className="tbl-wrap indicator-tbl">
        <table className="dt mobile-card-table">
          <thead>
            <tr>
              <th style={{ width: 150 }}>报表编码</th>
              <th>报表名称 / 用途</th>
              <th style={{ width: 120 }}>类型</th>
              <th style={{ width: 120 }}>归属部门</th>
              <th style={{ width: 92 }}>状态</th>
              <th style={{ width: 130 }}>关联引用</th>
              <th style={{ width: 190, textAlign: "right" }}>操作</th>
            </tr>
          </thead>
          <tbody>
            {reports.map((item) => (
              <tr key={item.code}>
                <td data-label="">
                  <button className="indicator-summary-btn" type="button" onClick={() => onView(item.code)}>
                    <span className="indicator-id mono"><Highlight text={item.code} q={query} /></span>
                  </button>
                </td>
                <td data-label="名称 / 用途">
                  <button className="indicator-summary-btn" type="button" onClick={() => onView(item.code)}>
                    <span className="indicator-name"><Highlight text={item.name} q={query} /></span>
                    <span className="indicator-meaning"><Highlight text={item.purpose || "暂无用途说明"} q={query} /></span>
                  </button>
                </td>
                <td data-label="类型">{item.type}</td>
                <td data-label="归属部门">{item.ownerDept}</td>
                <td data-label="状态"><StatusBadge status={item.status} /></td>
                <td data-label="关联引用" className="mono indicator-date">{item.relatedTableCount} 表 / {item.relatedIndicatorCount} 指标</td>
                <td data-label="" className="mobile-card-actions" style={{ textAlign: "right" }}>
                  <RowActions onView={() => onView(item.code)} onEdit={() => onEdit(item.code)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div> : view === "card" ? <ReportCardLayout reports={reports} query={query} onView={onView} onEdit={onEdit} /> : <ReportGroupLayout reports={reports} query={query} onView={onView} />}
    </div>
  );
}
