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
import { DomainBadge, Highlight, Icon, LayerBadge, initial } from "./ui.jsx";
import { CardGridView, EmptyState, GroupView } from "./common/index.js";

function fieldCount(table) {
  return Number.isFinite(Number(table.fieldCount)) ? Number(table.fieldCount) : table.fields.length;
}

function ListLayout({ tables, query, onOpen }) {
  return (
    <div className="tbl-wrap">
      <table className="dt mobile-card-table">
        <thead>
          <tr>
            <th style={{ width: "32%" }}>表名</th>
            <th>中文名 / 业务含义</th>
            <th style={{ width: 110 }}>主题域</th>
            <th style={{ width: 76 }}>分层</th>
            <th style={{ width: 130 }}>负责人</th>
            <th style={{ width: 80, textAlign: "right" }}>字段数</th>
          </tr>
        </thead>
        <tbody>
          {tables.map((table) => (
            <tr key={table.name} onClick={() => onOpen(table.name)}>
              <td data-label="">
                <div className="t-name">
                  <Icon name="table" size={15} color="var(--ink-3)" />
                  <span><Highlight text={table.name} q={query} /></span>
                  <span className="go"><Icon name="arrow" size={14} /></span>
                </div>
                {table._fieldMatch ? (
                  <div className="match-hint">
                    <Icon name="search" size={11} />匹配字段 <mark>{table._fieldMatch}</mark>
                  </div>
                ) : null}
              </td>
              <td data-label="业务含义"><span className="t-cn"><Highlight text={table.cn} q={query} /></span></td>
              <td data-label="主题域"><DomainBadge domain={table.domain} /></td>
              <td data-label="分层"><LayerBadge layer={table.layer} /></td>
              <td data-label="负责人">
                <div className="t-owner">
                  <span className="mini-av">{initial(table.owner)}</span>{table.owner}
                </div>
              </td>
              <td data-label="字段数" style={{ textAlign: "right" }}><span className="t-num">{fieldCount(table)}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CardLayout({ tables, query, onOpen }) {
  return (
    <CardGridView
      items={tables}
      getKey={(table) => table.name}
      onItemClick={(table) => onOpen(table.name)}
      renderBadges={(table) => (
        <>
          <DomainBadge domain={table.domain} />
          <LayerBadge layer={table.layer} />
        </>
      )}
      renderTitle={(table) => <Highlight text={table.cn} q={query} />}
      renderSubtitle={(table) => <Highlight text={table.name} q={query} />}
      renderDesc={(table) => table.desc}
      renderFootLeft={(table) => (
        <div className="t-owner" style={{ fontSize: 12.5 }}>
          <span className="mini-av" style={{ width: 22, height: 22 }}>{initial(table.owner)}</span>
          <span style={{ color: "var(--ink-2)" }}>{table.owner}</span>
        </div>
      )}
      renderFootMeta={(table) => (
        <span className="m"><Icon name="columns" size={13} /><b>{fieldCount(table)}</b> 字段</span>
      )}
    />
  );
}

function GroupLayout({ tables, query, onOpen }) {
  const order = ["会员", "交易", "商品", "库存", "营销", "履约", "售后"];
  return (
    <GroupView
      items={tables}
      getKey={(table) => table.name}
      onItemClick={(table) => onOpen(table.name)}
      groupBy={(table) => table.domain}
      groupOrder={order}
      renderGroupLabel={(domain) => <span className="tag tag-neutral">{domain}</span>}
      renderGroupCount={(count) => `${count} 张表`}
      renderCardName={(table) => <Highlight text={table.name} q={query} />}
      renderCardBody={(table) => (
        <>
          <span><Highlight text={table.cn} q={query} /></span>
          <span className="gc-owner">{table.owner} · {fieldCount(table)} 字段</span>
        </>
      )}
    />
  );
}

export function HomePage({ tables, layout, query, onOpen }) {
  if (tables.length === 0) {
    return <EmptyState title="未找到匹配的数据表" desc={`没有和 “${query}” 相关的表名或字段，试试其他关键词，或清除筛选条件。`} />;
  }
  if (layout === "card") return <CardLayout tables={tables} query={query} onOpen={onOpen} />;
  if (layout === "group") return <GroupLayout tables={tables} query={query} onOpen={onOpen} />;
  return <ListLayout tables={tables} query={query} onOpen={onOpen} />;
}
