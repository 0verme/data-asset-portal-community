import React from "react";

import { ActionErrorBanner, AssetReferenceSelector, BinaryStatusToggle, CardGridView, EmptyState, ErrorState, GroupView, LoadingState, PageHeader, RowActions, StatusBadge, ViewModeSwitcher } from "../common/index.ts";

const blank = { code: "", name: "", method: "GET", path: "", version: "v1", downstreamSystemId: "", type: "", status: "enabled", ownerDept: "", ownerName: "", maintainerName: "", description: "", remark: "", params: [], responseFields: [], relations: [] };

function normalizeRelations(relations) {
  const tables = []; const indicators = []; const others = [];
  (Array.isArray(relations) ? relations : []).forEach((relation) => {
    if (relation.type === "table") tables.push({ tableName: relation.targetCode, tableCn: relation.targetName || "" });
    else if (relation.type === "indicator") indicators.push({ indicatorId: relation.targetCode, indicatorName: relation.targetName || "" });
    else others.push(relation);
  });
  return { tables, indicators, others };
}

function relationRows(tables, indicators, others) {
  return [...tables.map((item) => ({ type: "table", targetCode: item.tableName, targetName: item.tableCn || "" })), ...indicators.map((item) => ({ type: "indicator", targetCode: item.indicatorId, targetName: item.indicatorName || "" })), ...others];
}

function Rows({ title, items, onChange, kind }) {
  const add = () => onChange([...items, kind === "params" ? { name: "", in: "query", dataType: "string", required: false, description: "", example: "" } : { name: "", dataType: "string", description: "", example: "" }]);
  const update = (index, patch) => onChange(items.map((item, current) => current === index ? { ...item, ...patch } : item));
  return (
    <div className="form-card">
      <h3>{title}</h3>
      <div className="tbl-wrap">
        <table className="dt mobile-edit-table">
          <thead><tr><th>名称</th>{kind === "params" ? <th>位置</th> : null}<th>类型</th><th>说明</th><th>操作</th></tr></thead>
          <tbody>
            {items.map((row, index) => (
              <tr key={index}>
                <td data-label="名称"><input className="inp mono" value={row.name} onChange={(event) => update(index, { name: event.target.value })} /></td>
                {kind === "params" ? <td data-label="位置"><select className="sel" value={row.in} onChange={(event) => update(index, { in: event.target.value })}>{["query", "path", "header", "body"].map((value) => <option key={value}>{value}</option>)}</select></td> : null}
                <td data-label="类型"><input className="inp" value={row.dataType} onChange={(event) => update(index, { dataType: event.target.value })} /></td>
                <td data-label="说明"><input className="inp" value={row.description || ""} onChange={(event) => update(index, { description: event.target.value })} /></td>
                <td data-label=""><button className="btn ghost-danger" type="button" onClick={() => onChange(items.filter((_, current) => current !== index))}>删除</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button className="btn" type="button" onClick={add}>+ 添加</button>
    </div>
  );
}

function SystemPicker({ systems, value, onChange }) {
  const [query, setQuery] = React.useState("");
  const options = systems.filter((system) => !query || [system.name, system.short_name].some((item) => String(item || "").toLowerCase().includes(query.toLowerCase())));
  return <div className="system-picker"><input className="inp" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索系统名称或简称" /><select className="sel" value={value || ""} onChange={(event) => onChange(event.target.value)} required><option value="">请选择业务系统</option>{options.map((system) => <option key={system.id} value={system.id} disabled={system.status !== "enabled"}>{system.name}（{system.short_name}）{system.status !== "enabled" ? "（已禁用）" : ""}</option>)}</select></div>;
}

function Editor({ item, systems, onSave, onCancel, error }) {
  const [form, setForm] = React.useState({ ...blank, ...(item || {}) });
  const initial = React.useMemo(() => normalizeRelations(item?.relations), [item]);
  const [tables, setTables] = React.useState(initial.tables); const [indicators, setIndicators] = React.useState(initial.indicators);
  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const submit = () => onSave({ ...form, code: form.code.trim().toUpperCase(), systemId: Number(form.downstreamSystemId), relations: relationRows(tables, indicators, initial.others) });
  return <><PageHeader breadcrumbs={[{ label: "API 资产", onClick: onCancel }, { label: item ? "编辑 API" : "新增 API" }]} icon={item ? "edit" : "plus"} title={item ? "编辑 API" : "新增 API"} subtitle="维护 API 元数据、请求参数、响应字段与资产关联。" /><ActionErrorBanner message={error} /><div className="form-card"><h3>基本信息</h3><div className="form-grid">{[["code", "API 编码"], ["name", "API 名称"], ["path", "请求路径"], ["version", "版本"], ["type", "API 类型"], ["ownerDept", "归属部门"], ["ownerName", "负责人"], ["maintainerName", "维护人"]].map(([key, label]) => <div className="fl" key={key}><label>{label}</label><input className={`inp${key === "code" || key === "path" ? " mono" : ""}`} value={form[key]} disabled={Boolean(item) && key === "code"} onChange={(event) => set(key, event.target.value)} /></div>)}<div className="fl"><label>下游调用系统</label><SystemPicker systems={systems} value={form.downstreamSystemId} onChange={(value) => set("downstreamSystemId", value)} /><small className="field-error">{!form.downstreamSystemId ? "请选择下游调用系统" : ""}</small></div><div className="fl"><label>请求方式</label><select className="sel" value={form.method} onChange={(event) => set("method", event.target.value)}>{["GET", "POST", "PUT", "PATCH", "DELETE"].map((value) => <option key={value}>{value}</option>)}</select></div><div className="fl"><label>状态</label><BinaryStatusToggle mode="status" name="status" value={form.status} onChange={(value) => set("status", value)} /></div><div className="fl full"><label>说明</label><textarea className="ta" value={form.description} onChange={(event) => set("description", event.target.value)} /></div><div className="fl full"><label>备注</label><textarea className="ta" value={form.remark} onChange={(event) => set("remark", event.target.value)} /></div></div></div><Rows title="请求参数" items={form.params} onChange={(value) => set("params", value)} kind="params" /><Rows title="响应字段" items={form.responseFields} onChange={(value) => set("responseFields", value)} kind="responseFields" /><div className="form-card"><h3>关联资产</h3><AssetReferenceSelector selectedTables={tables} selectedIndicators={indicators} onTablesChange={setTables} onIndicatorsChange={setIndicators} /></div><div className="form-actions"><button className="btn" onClick={onCancel}>取消</button><button className="btn primary" onClick={submit} disabled={!form.downstreamSystemId}>保存</button></div></>;
}

function ApiEmptyState({ query }) { return <EmptyState title={query ? "未找到符合条件的 API 资产" : "暂无 API 资产"} />; }
function systemLabel(item) { return item.downstreamSystemName || "未关联"; }
function systemCode(item) { return item.downstreamSystemShortName ? `（${item.downstreamSystemShortName}）` : ""; }

function ApiCards({ items, onView, onEdit, onToggle, pendingIds, canEdit }) {
  return <CardGridView items={items} getKey={(item) => item.code} onItemClick={(item) => onView(item.code)} renderBadges={(item) => <><span className="tag tag-neutral">{item.method}</span><StatusBadge status={item.status} /></>} renderTitle={(item) => item.name} renderSubtitle={(item) => item.code} renderDesc={(item) => <span className="mono" title={item.path}>{item.path}</span>} renderFootLeft={(item) => <span className="t-owner">{systemLabel(item)}{systemCode(item)}</span>} renderFootMeta={(item) => <span className="m">负责人 <b>{item.ownerName || "未设置"}</b></span>} renderFootActions={(item) => <RowActions disabled={pendingIds.includes(item.code)} onView={() => onView(item.code)} onEdit={canEdit ? () => onEdit(item.code) : undefined} toggle={canEdit ? { enabled: item.status === "enabled", label: item.name, onToggle: () => onToggle(item) } : undefined} />} />;
}

function ApiGroups({ items, onView }) {
  return <GroupView items={items} getKey={(item) => item.code} onItemClick={(item) => onView(item.code)} groupBy={(item) => item.downstreamSystemId == null || !item.downstreamSystemName ? "__unlinked__" : String(item.downstreamSystemId)} groupOrder={["__unlinked__"]} renderGroupLabel={(key) => { const item = items.find((entry) => (entry.downstreamSystemId == null || !entry.downstreamSystemName ? "__unlinked__" : String(entry.downstreamSystemId)) === key); return key === "__unlinked__" ? "未关联" : <>{item.downstreamSystemName}{item.downstreamSystemShortName ? `（${item.downstreamSystemShortName}）` : ""}</>; }} renderGroupCount={(count) => `${count} 个 API`} renderCardName={(item) => item.code} renderCardBody={(item) => <><span>{item.name}</span><span className="gc-owner mono">{item.method} {item.path}</span></>} />;
}

function ApiList({ items, query, view, onChangeView, apiAsset, canEdit }) {
  return <><div className="page-head"><div><div className="page-title"><span className="pt-code">API</span>API 资产</div><div className="page-sub">共 <b>{items.length}</b> 个 API，可按请求方式、下游调用系统和状态筛选。</div></div><div className="head-actions"><ViewModeSwitcher value={view} onChange={onChangeView} />{canEdit ? <button className="btn primary" onClick={apiAsset.create}>新增 API</button> : null}</div></div>{!items.length ? <ApiEmptyState query={query} /> : view === "list" ? <div className="tbl-wrap"><table className="dt mobile-card-table"><thead><tr><th>API</th><th>请求</th><th>下游调用系统</th><th>负责人</th><th>状态</th><th>操作</th></tr></thead><tbody>{items.map((item) => <tr key={item.code}><td data-label=""><b>{item.name}</b><div className="mono">{item.code}</div></td><td data-label="请求"><span className="mono">{item.method} {item.path}</span></td><td data-label="下游系统">{systemLabel(item)}{systemCode(item)}</td><td data-label="负责人">{item.ownerName}</td><td data-label="状态"><StatusBadge status={item.status} /></td><td data-label="" className="mobile-card-actions"><RowActions disabled={apiAsset.pendingIds.includes(item.code)} onView={() => apiAsset.view(item.code)} onEdit={canEdit ? () => apiAsset.edit(item.code) : undefined} toggle={canEdit ? { enabled: item.status === "enabled", label: item.name, onToggle: () => apiAsset.toggle(item) } : undefined} /></td></tr>)}</tbody></table></div> : view === "card" ? <ApiCards items={items} onView={apiAsset.view} onEdit={apiAsset.edit} onToggle={apiAsset.toggle} pendingIds={apiAsset.pendingIds} canEdit={canEdit} /> : <ApiGroups items={items} onView={apiAsset.view} />}</>;
}

export function ApiAssetView({ apiAsset, query, route, view, onChangeView, canEdit = false }) {
  if (apiAsset.loading) return <LoadingState title="加载 API 资产" desc="正在读取 API 元数据台账。" />;
  if (apiAsset.error) return <ErrorState title="API 资产加载失败" desc={apiAsset.error} onRetry={apiAsset.load} />;
  if (!canEdit && ["new", "edit"].includes(route.page)) {
    return <EmptyState title="当前页面需要 API 资产维护权限" desc="API 目录可以公开浏览，新增和编辑需要相应写权限。" />;
  }
  if (route.page === "new" || route.page === "edit") return <Editor item={route.page === "edit" ? apiAsset.current : null} systems={apiAsset.systems} onSave={apiAsset.save} onCancel={apiAsset.back} error={apiAsset.saveError} />;
  if (route.page === "view" && apiAsset.current) { const item = apiAsset.current; const relations = normalizeRelations(item.relations); return <><PageHeader breadcrumbs={[{ label: "API 资产", onClick: apiAsset.back }, { label: item.name }]} icon="api" title={item.name} subtitle={item.code} /><div className="detail-head"><div className="indicator-detail-grid"><div className="indicator-detail-item"><div className="indicator-detail-label">请求</div><div className="indicator-detail-value mono">{item.method} {item.path}</div></div><div className="indicator-detail-item"><div className="indicator-detail-label">下游调用系统</div><div className="indicator-detail-value">{systemLabel(item)}{systemCode(item)}</div></div><div className="indicator-detail-item"><div className="indicator-detail-label">状态</div><div className="indicator-detail-value"><StatusBadge status={item.status} /></div></div><div className="indicator-detail-item"><div className="indicator-detail-label">归属</div><div className="indicator-detail-value">{item.ownerDept} / {item.ownerName}</div></div><div className="indicator-detail-item full"><div className="indicator-detail-label">说明</div><div className="indicator-detail-value">{item.description || "-"}</div></div></div></div><div className="form-card"><h3>关联资产</h3><AssetReferenceSelector selectedTables={relations.tables} selectedIndicators={relations.indicators} onTablesChange={() => {}} onIndicatorsChange={() => {}} readonly /></div>{canEdit ? <button className="btn" onClick={() => apiAsset.edit(item.code)}>编辑</button> : null}</>; }
  return <ApiList items={apiAsset.filtered} query={query} view={view} onChangeView={onChangeView} apiAsset={apiAsset} canEdit={canEdit} />;
}
