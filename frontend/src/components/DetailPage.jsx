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
import { AssetRisksPanel } from "./AssetRisksPanel.jsx";
import { DomainBadge, Highlight, Icon, LayerBadge, initial } from "./ui.jsx";
import { MetaItem, PageHeader } from "./common/index.js";
import { buildModuleBreadcrumbs } from "../routing/navigation.ts";

const DDL_KEYWORDS = new Set([
  "CREATE",
  "TABLE",
  "IF",
  "NOT",
  "EXISTS",
  "COMMENT",
  "BY",
  "ON",
  "IS",
  "DISTRIBUTE",
  "HASH",
]);

const DDL_TYPES = new Set([
  "VARCHAR",
  "TEXT",
  "BIGINT",
  "INT",
  "INTEGER",
  "DECIMAL",
  "NUMERIC",
  "TIMESTAMP",
  "DATE",
  "DOUBLE",
  "FLOAT",
  "BOOLEAN",
  "SMALLINT",
  "TINYINT",
]);

function renderDDLLine(line, index) {
  const fieldMatch = line.match(/^(\s*)([a-zA-Z_][\w]*)(\s+)([A-Z]+(?:\(\d+(?:,\s*\d+)?\))?)(\s+)(COMMENT)(\s+)('.*?')(,?)$/);
  if (fieldMatch) {
    const [, indent, fieldName, gap1, fieldType, gap2, commentKeyword, gap3, commentText, trailingComma] = fieldMatch;
    return (
      <React.Fragment key={index}>
        <span>{indent}</span>
        <span className="ddl-field">{fieldName}</span>
        <span>{gap1}</span>
        <span className="ddl-type">{fieldType}</span>
        <span>{gap2}</span>
        <span className="ddl-keyword">{commentKeyword}</span>
        <span>{gap3}</span>
        <span className="ddl-comment">{commentText}</span>
        <span>{trailingComma}</span>
      </React.Fragment>
    );
  }

  const tokens = [];
  const regex = /('(?:[^'\\]|\\.)*'|[A-Z_]+(?:\(\d+(?:,\s*\d+)?\))?|[a-zA-Z_][\w.]*|\s+|[(),;=])/g;
  let lastIndex = 0;
  let match;
  while ((match = regex.exec(line)) !== null) {
    if (match.index > lastIndex) {
      tokens.push(<span key={`${index}-raw-${lastIndex}`}>{line.slice(lastIndex, match.index)}</span>);
    }

    const token = match[0];
    let className = "";
    if (token.startsWith("'") && token.endsWith("'")) {
      className = "ddl-comment";
    } else if (DDL_KEYWORDS.has(token)) {
      className = "ddl-keyword";
    } else if (DDL_TYPES.has(token.replace(/\(.+$/, ""))) {
      className = "ddl-type";
    } else if (/^[a-zA-Z_][\w.]*$/.test(token) && token === token.toLowerCase()) {
      className = "ddl-field";
    }

    tokens.push(<span key={`${index}-${match.index}`} className={className || undefined}>{token}</span>);
    lastIndex = regex.lastIndex;
  }

  if (lastIndex < line.length) {
    tokens.push(<span key={`${index}-tail`}>{line.slice(lastIndex)}</span>);
  }

  return <React.Fragment key={index}>{tokens}</React.Fragment>;
}

function renderDDL(ddl) {
  return ddl.split("\n").map((line, index, lines) => (
    <React.Fragment key={`line-${index}`}>
      {renderDDLLine(line, index)}
      {index < lines.length - 1 ? "\n" : null}
    </React.Fragment>
  ));
}

function DDLView({ asset, ddl, ddlDialectLabel }) {
  const [copied, setCopied] = React.useState(false);

  const copy = async () => {
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(ddl);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div className="ddl-wrap">
      <div className="ddl-bar">
        <span className="ddl-lang"><span className="d"></span>{ddlDialectLabel} · 建表语句</span>
        <button className={"btn" + (copied ? " copied" : "")} onClick={copy} style={{ height: 30 }}>
          <Icon name={copied ? "check" : "copy"} size={14} />{copied ? "已复制" : "复制 DDL"}
        </button>
      </div>
      <pre className="ddl" aria-label={`${asset.name} DDL`}>
        <code className="ddl-code">{renderDDL(ddl)}</code>
      </pre>
    </div>
  );
}

function EnumCell({ field }) {
  if (!field.enum) return <span className="dash" style={{ color: "var(--ink-3)" }}>-</span>;
  if (/\s\/\s/.test(field.enum) && /-/.test(field.enum)) {
    return (
      <div>
        {field.enum.split("/").map((segment, index) => (
          <span className="ev" key={index}>{segment.trim()}</span>
        ))}
      </div>
    );
  }
  return <span>{field.enum}</span>;
}

function FieldsView({ fields }) {
  const [fieldQuery, setFieldQuery] = React.useState("");
  const normalizedQuery = fieldQuery.trim().toLowerCase();
  const rows = fields.filter(
    (field) =>
      !normalizedQuery ||
      field.name.toLowerCase().includes(normalizedQuery) ||
      field.cn.toLowerCase().includes(normalizedQuery),
  );

  return (
    <div>
      <div className="field-toolbar">
        <div className="ft-search">
          <span className="ico-search"><Icon name="search" size={14} /></span>
          <input
            placeholder="在当前表内筛选字段"
            value={fieldQuery}
            onChange={(event) => setFieldQuery(event.target.value)}
          />
        </div>
        <span className="ft-info">
          共 <b style={{ color: "var(--ink-2)" }}>{fields.length}</b> 个字段
          {normalizedQuery ? ` · 命中 ${rows.length}` : ""}
        </span>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table className="fields">
          <thead>
            <tr>
              <th className="c-idx">#</th>
              <th>字段名</th>
              <th>中文注释</th>
              <th style={{ width: 130 }}>数据类型</th>
              <th style={{ width: 80 }}>可空</th>
              <th>枚举 / 取值说明</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((field) => (
              <tr key={field.name}>
                <td className="c-idx">{fields.findIndex((item) => item.name === field.name) + 1}</td>
                <td className="c-name">
                  <Highlight text={field.name} q={fieldQuery} />
                  {(field.pk || field.part) ? (
                    <span className="keys">
                      {field.pk ? <span className="key-tag key-pk">PK</span> : null}
                      {field.part ? <span className="key-tag key-part">分区</span> : null}
                    </span>
                  ) : null}
                </td>
                <td className="c-cn"><Highlight text={field.cn} q={fieldQuery} /></td>
                <td className="c-type">{field.type}</td>
                <td className="c-null">{field.nullable ? <span className="null-yes">可空</span> : <span className="null-no">NOT NULL</span>}</td>
                <td className="c-enum"><EnumCell field={field} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function DetailPage({ asset, fields, ddl, ddlDialectLabel, tab, onTabChange, onBack, onBackToList, onEdit }) {
  const [copied, setCopied] = React.useState(false);

  const copyName = async () => {
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(`dwm.${asset.name}`);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div>
      <PageHeader
        back={{ onClick: onBack, text: "返回数据仓库列表" }}
        breadcrumbs={buildModuleBreadcrumbs("dwm", [
          { label: asset.name },
        ], onBackToList)}
      />

      <div className="detail-head">
        <div className="dh-top">
          <div>
            <div className="dh-title">
              <Icon name="table" size={22} color="var(--accent)" />
              <span className="dh-en">{asset.name}</span>
              <DomainBadge domain={asset.domain} />
              <LayerBadge layer={asset.layer} />
            </div>
            <div className="dh-cn">{asset.cn}</div>
            <div className="dh-desc">{asset.desc}</div>
          </div>
          <div className="dh-actions">
            <button className="btn" onClick={onEdit}>
              <Icon name="edit" size={15} />编辑表
            </button>
            <button className={"btn" + (copied ? " copied" : "")} onClick={copyName}>
              <Icon name={copied ? "check" : "copy"} size={15} />{copied ? "已复制" : "复制表名"}
            </button>
            <button className="btn primary" onClick={() => onTabChange("ddl")}>
              <Icon name="code" size={15} />查看 DDL
            </button>
          </div>
        </div>
        <div className="dh-meta">
          <MetaItem label="负责人" value={<><span className="mini-av" style={{ width: 22, height: 22 }}>{initial(asset.owner)}</span>{asset.owner}</>} />
          <MetaItem label="数据粒度" value={asset.grain} />
          <MetaItem label="更新周期" value={<><Icon name="clock" size={14} color="var(--ink-3)" />{asset.cycle}</>} />
          <MetaItem label="字段数量" value={fields.length} mono />
          <MetaItem label="存储表" value={`dwm.${asset.name}`} mono />
        </div>
      </div>

      <AssetRisksPanel assetRisks={asset.assetRisks || []} />

      <div className="tabs">
        <div className={"tab" + (tab === "fields" ? " active" : "")} onClick={() => onTabChange("fields")}>
          <Icon name="columns" size={15} />字段信息 <span className="tab-n">{fields.length}</span>
        </div>
        <div className={"tab" + (tab === "ddl" ? " active" : "")} onClick={() => onTabChange("ddl")}>
          <Icon name="code" size={15} />建表语句
        </div>
      </div>
      <div className="panel">
        {tab === "fields" ? <FieldsView fields={fields} /> : <DDLView asset={asset} ddl={ddl} ddlDialectLabel={ddlDialectLabel} />}
      </div>
    </div>
  );
}
