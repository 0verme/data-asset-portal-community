// Copyright 2025 Jearhe
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import React from "react";
import { Highlight, Icon } from "./ui.jsx";
import { ActionErrorBanner, confirmDeleteAction, DangerZone, EmptyState, FormActionBar, PageHeader, RowActions } from "./common/index.js";
import { buildModuleBreadcrumbs } from "../routing/navigation.ts";
import { ROOT_ABBR_RULE_MESSAGE, isValidRootAbbr } from "../utils/rootValidation.ts";

function CatBadge({ cat }) {
  return <span className="tag tag-neutral">{cat}</span>;
}

export function RootLibrary({
  roots,
  allRoots,
  query,
  activeCategory,
  categories,
  onSetCategory,
  onEdit,
  onNew,
  onImport,
  onClearQuery,
  canEdit = false,
}) {
  const counts = allRoots.reduce((acc, item) => {
    acc[item.cat] = (acc[item.cat] || 0) + 1;
    return acc;
  }, {});

  return (
    <div className="root-page">
      <div className="page-head">
        <div>
          <div className="page-title"><Icon name="book" size={21} color="var(--ink-2)" />词根库</div>
          <div className="page-sub">
            数据仓库命名规范词根，用于拼装表名与字段名，共 <b>{roots.length}</b> 个
            {query ? <>，匹配 “{query}”</> : null}
          </div>
        </div>
        <div className="head-actions">
          {canEdit ? <button className="btn" onClick={onImport}><Icon name="upload" size={15} />批量导入</button> : null}
          {canEdit ? <button className="btn primary" onClick={onNew}><Icon name="plus" size={15} />新增词根</button> : null}
        </div>
      </div>

      <div className="stat-row">
        <div className="stat-card">
          <div className="sv">{allRoots.length}</div>
          <div className="sl">词根总数</div>
        </div>
        {categories.map((item) => (
          <div
            key={item.name}
            className={"stat-card" + (activeCategory === item.name ? " active" : "")}
            onClick={() => onSetCategory(activeCategory === item.name ? null : item.name)}
          >
            <div className="sv">{counts[item.name] || item.count || 0}</div>
            <div className="sl">{item.name}</div>
          </div>
        ))}
      </div>

      {(activeCategory || query) ? (
        <div className="filter-bar">
          <span className="fb-label">筛选:</span>
          {activeCategory ? (
            <span className="chip-active">
              {activeCategory}
              <button onClick={() => onSetCategory(null)}><Icon name="close" size={12} /></button>
            </span>
          ) : null}
          {query ? (
            <span className="chip-active">
              “{query}”
              <button onClick={onClearQuery}><Icon name="close" size={12} /></button>
            </span>
          ) : null}
        </div>
      ) : null}

      {!roots.length ? (
        <EmptyState title="未找到匹配的词根" desc="换个关键词，或新增 / 导入词根。" />
      ) : (
        <div className="tbl-wrap root-tbl">
          <table className="dt mobile-card-table">
            <thead>
              <tr>
                <th style={{ width: 130 }}>词根</th>
                <th style={{ width: 180 }}>英文全称</th>
                <th style={{ width: 140 }}>中文名</th>
                <th style={{ width: 120 }}>分类</th>
                <th>说明 / 示例</th>
                <th style={{ width: 100, textAlign: "right" }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {roots.map((item) => (
                <tr key={item.abbr} onClick={canEdit ? () => onEdit(item.abbr) : undefined}>
                  <td data-label=""><span className="root-abbr"><Highlight text={item.abbr} q={query} /></span></td>
                  <td data-label="英文全称"><span className="root-en"><Highlight text={item.en} q={query} /></span></td>
                  <td data-label="中文名"><Highlight text={item.cn} q={query} /></td>
                  <td data-label="分类"><CatBadge cat={item.cat} /></td>
                  <td data-label="说明">{item.desc || "-"}</td>
                  <td data-label="" className="mobile-card-actions" style={{ textAlign: "right" }} onClick={(event) => event.stopPropagation()}>
                    <RowActions onEdit={canEdit ? () => onEdit(item.abbr) : undefined} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function RootEditor({ mode, initial, categories, existingAbbrs, onSave, onCancel, onDelete }) {
  const isEdit = mode === "edit";
  const oldAbbr = initial?.abbr || "";
  const [form, setForm] = React.useState(() => initial || {
    abbr: "",
    en: "",
    cn: "",
    cat: categories[0]?.name || categories[0] || "",
    desc: "",
  });
  const [touched, setTouched] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const initialSnapshotRef = React.useRef(JSON.stringify(form));
  const isDirty = initialSnapshotRef.current !== JSON.stringify(form);

  React.useEffect(() => {
    const nextForm = initial || {
      abbr: "",
      en: "",
      cn: "",
      cat: categories[0]?.name || categories[0] || "",
      desc: "",
    };
    setForm(nextForm);
    setTouched(false);
    initialSnapshotRef.current = JSON.stringify(nextForm);
  }, [initial, categories]);

  const categoryNames = categories.map((item) => item.name || item);
  const errors = [];
  if (touched) {
    if (!form.abbr.trim()) {
      errors.push("词根缩写不能为空");
    } else if (!isValidRootAbbr(form.abbr)) {
      errors.push(ROOT_ABBR_RULE_MESSAGE);
    } else if (existingAbbrs.some((item) => item === form.abbr.trim() && item !== oldAbbr)) {
      errors.push(`词根 ${form.abbr.trim()} 已存在`);
    }
    if (!form.cn.trim()) errors.push("中文名不能为空");
  }

  const save = async () => {
    setTouched(true);
    if (errors.length || saving) return;
    setSaving(true);
    try {
      await Promise.resolve(onSave({
      abbr: form.abbr.trim(),
      en: form.en.trim(),
      cn: form.cn.trim(),
      cat: form.cat,
      desc: form.desc.trim(),
      }, oldAbbr || undefined));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <PageHeader
        back={{ onClick: onCancel, text: isEdit ? "返回上一层" : "返回词根列表" }}
        breadcrumbs={buildModuleBreadcrumbs("root", [
          { label: isEdit ? "编辑词根" : "新增词根" },
        ], onCancel)}
        icon={isEdit ? "edit" : "plus"}
        title={isEdit ? "编辑词根" : "新增词根"}
        subtitle={isEdit ? oldAbbr : "添加一个命名词根"}
      />

      <ActionErrorBanner title="请先修正以下问题" messages={errors} />

      <div className="form-card">
        <h3><Icon name="book" size={14} />词根信息</h3>
        <div className="form-grid">
          <div className="fl">
            <label>词根缩写</label>
            <input className={`inp mono${touched && !isValidRootAbbr(form.abbr) ? " invalid" : ""}`} value={form.abbr} onChange={(event) => setForm((prev) => ({ ...prev, abbr: event.target.value }))} placeholder="例如：trans" />
          </div>
          <div className="fl">
            <label>英文全称</label>
            <input className="inp mono" value={form.en} onChange={(event) => setForm((prev) => ({ ...prev, en: event.target.value }))} placeholder="例如：transaction" />
          </div>
          <div className="fl">
            <label>中文名</label>
            <input className={`inp${touched && !form.cn.trim() ? " invalid" : ""}`} value={form.cn} onChange={(event) => setForm((prev) => ({ ...prev, cn: event.target.value }))} placeholder="例如：交易流水" />
          </div>
          <div className="fl">
            <label>分类</label>
            <select className="sel" value={form.cat} onChange={(event) => setForm((prev) => ({ ...prev, cat: event.target.value }))}>
              {categoryNames.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </div>
          <div className="fl full">
            <label>说明 / 示例</label>
            <textarea className="ta" value={form.desc} onChange={(event) => setForm((prev) => ({ ...prev, desc: event.target.value }))} placeholder="例如：trans_id 交易流水号 / trans_status 交易状态" />
          </div>
        </div>
      </div>

      <FormActionBar
        note={isEdit ? "保存后将更新该词根" : "保存后将加入词根库"}
        onCancel={onCancel}
        onSave={save}
        saving={saving}
        isDirty={isDirty}
      />
      {isEdit ? (
        <DangerZone
          description="删除词根可能影响字段命名规范、字段映射和历史命名追溯，建议谨慎操作。"
          actions={[
            {
              key: "delete-root",
              label: "删除词根",
              icon: "trash",
              danger: true,
              onClick: async () => {
                if (await confirmDeleteAction({
                  name: oldAbbr,
                  typeLabel: "词根",
                  impact: "该词根删除后，可能影响字段命名规范、字段映射和历史命名追溯。建议谨慎操作。",
                  consequences: [
                    "删除前应以服务端依赖校验结果为准。",
                    "若后端返回不可删除原因，页面会直接展示原因。",
                  ],
                  confirmKeyword: oldAbbr,
                  confirmKeywordLabel: "请输入词根缩写二次确认",
                })) onDelete(oldAbbr);
              },
            },
          ]}
        />
      ) : null}
    </div>
  );
}

function parseDelimited(text) {
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n").filter(Boolean);
  if (!lines.length) return { items: [], error: "内容为空" };

  const delimiter = lines[0].includes("\t") ? "\t" : lines[0].includes("|") ? "|" : ",";
  const rows = lines.map((line) => line.split(delimiter).map((cell) => cell.trim().replace(/^"(.*)"$/, "$1")));
  const firstRow = rows[0].map((cell) => cell.toLowerCase());
  const hasHeader = firstRow.some((cell) => /abbr|root|词根|缩写/.test(cell));
  const startIndex = hasHeader ? 1 : 0;
  const header = hasHeader ? firstRow : [];
  const indexMap = { abbr: 0, en: 1, cn: 2, cat: 3, desc: 4 };

  header.forEach((cell, index) => {
    if (/abbr|root|词根|缩写/.test(cell)) indexMap.abbr = index;
    if (/en|english|全称/.test(cell)) indexMap.en = index;
    if (/cn|中文|名称/.test(cell)) indexMap.cn = index;
    if (/cat|分类|类别/.test(cell)) indexMap.cat = index;
    if (/desc|说明|备注|示例/.test(cell)) indexMap.desc = index;
  });

  return {
    items: rows.slice(startIndex).map((row, idx) => ({
      abbr: row[indexMap.abbr] || "",
      en: row[indexMap.en] || "",
      cn: row[indexMap.cn] || "",
      cat: row[indexMap.cat] || "",
      desc: row[indexMap.desc] || "",
      _line: idx + startIndex + 1,
    })),
  };
}

export function RootImport({ roots, categories, onBack, onCommit }) {
  const [text, setText] = React.useState("");
  const [preview, setPreview] = React.useState(null);
  const fileRef = React.useRef(null);
  const categoryNames = categories.map((item) => item.name || item);
  const existingMap = React.useMemo(() => new Map(roots.map((item) => [item.abbr, item])), [roots]);

  const analyze = React.useCallback((value) => {
    const parsed = parseDelimited(value);
    if (parsed.error) {
      setPreview({ error: parsed.error, items: [] });
      return;
    }

    const seen = new Set();
    const items = parsed.items.map((item) => {
      if (!item.abbr) return { row: item, action: "error", message: "缺少词根缩写" };
      if (!isValidRootAbbr(item.abbr)) return { row: item, action: "error", message: ROOT_ABBR_RULE_MESSAGE };
      if (!item.cn) return { row: item, action: "error", message: "缺少中文名" };
      if (seen.has(item.abbr)) return { row: item, action: "error", message: "导入文件内词根重复" };
      seen.add(item.abbr);

      const normalized = {
        ...item,
        cat: categoryNames.includes(item.cat) ? item.cat : "公共词根",
      };
      const oldItem = existingMap.get(item.abbr);
      if (!oldItem) return { row: normalized, action: "new" };
      const changed = ["en", "cn", "cat", "desc"].filter((key) => (oldItem[key] || "") !== (normalized[key] || ""));
      if (!changed.length) return { row: normalized, action: "same" };
      return { row: normalized, action: "update", changed };
    });

    setPreview({ items });
  }, [categoryNames, existingMap]);

  const summary = preview?.items?.reduce((acc, item) => {
    acc[item.action] = (acc[item.action] || 0) + 1;
    return acc;
  }, {}) || {};

  const commit = () => {
    const items = preview.items.filter((item) => item.action === "new" || item.action === "update").map((item) => item.row);
    onCommit(items);
  };

  return (
    <div>
      <PageHeader
        back={{ onClick: onBack, text: "返回词根列表" }}
        breadcrumbs={buildModuleBreadcrumbs("root", [
          { label: "批量导入" },
        ], onBack)}
      />

      <div className="editor-head">
        <div>
          <div className="editor-title">
            <Icon name="upload" size={20} color="var(--ink-2)" />
            <h2>批量导入词根</h2>
          </div>
          <div className="editor-sub">支持 Excel 粘贴、CSV / TSV 文件导入，预览后执行 upsert。</div>
        </div>
        <div className="editor-actions">
          <button className="btn" onClick={onBack}><Icon name="close" size={14} />返回</button>
        </div>
      </div>

      <div className="import-zone">
        <div className="drop-area" onClick={() => fileRef.current?.click()}>
          <div className="di"><Icon name="file" size={26} /></div>
          <h4>选择 CSV / TSV 文件，或直接粘贴 Excel 内容</h4>
          <p>列顺序建议: abbr, en, cn, cat, desc。首行支持表头自动识别。</p>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.tsv,.txt"
            style={{ display: "none" }}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              const reader = new FileReader();
              reader.onload = () => {
                const value = String(reader.result || "");
                setText(value);
                analyze(value);
              };
              reader.readAsText(file, "utf-8");
            }}
          />
        </div>

        <textarea
          className="paste-ta"
          value={text}
          onChange={(event) => {
            const value = event.target.value;
            setText(value);
            if (!value.trim()) {
              setPreview(null);
              return;
            }
            analyze(value);
          }}
          placeholder={"abbr,en,cn,cat,desc\ntrans,transaction,交易流水,业务对象,交易明细类命名词根"}
        />
      </div>

      {preview ? (
        preview.error ? (
          <ActionErrorBanner title="导入预览失败" message={preview.error} />
        ) : (
          <>
            <div className="imp-summary">
              <span className="imp-chip new">新增 {summary.new || 0}</span>
              <span className="imp-chip upd">更新 {summary.update || 0}</span>
              <span className="imp-chip same">不变 {summary.same || 0}</span>
              <span className="imp-chip err">错误 {summary.error || 0}</span>
            </div>

            <div className="panel">
              <div style={{ overflowX: "auto" }}>
                <table className="fields">
                  <thead>
                    <tr>
                      <th className="c-idx">行</th>
                      <th style={{ width: 90 }}>动作</th>
                      <th style={{ width: 120 }}>词根</th>
                      <th style={{ width: 140 }}>中文名</th>
                      <th style={{ width: 120 }}>分类</th>
                      <th>说明</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.items.map((item) => (
                      <tr key={`${item.row.abbr}_${item.row._line}`}>
                        <td className="c-idx">{item.row._line}</td>
                        <td>{item.action}</td>
                        <td className="c-name">{item.row.abbr || "-"}</td>
                        <td>{item.row.cn || "-"}</td>
                        <td>{item.row.cat || "-"}</td>
                        <td>{item.message || item.row.desc || "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="ed-foot">
              <span className="ef-note">仅会提交新增与更新项，错误项会被跳过。</span>
              <div className="ed-foot-actions">
                <button className="btn" onClick={() => { setText(""); setPreview(null); }}>清空</button>
                <button className="btn primary" disabled={!((summary.new || 0) + (summary.update || 0))} onClick={commit}>
                  <Icon name="check" size={14} />确认导入
                </button>
              </div>
            </div>
          </>
        )
      ) : null}
    </div>
  );
}
