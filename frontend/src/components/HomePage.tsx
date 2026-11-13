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

import { useTranslation } from "react-i18next";

import type { AssetTableItem } from "../api/assets.ts";
import { EmptyState } from "../ui/index.ts";
import { CardGridView, GroupView, WideTableScroll } from "./common/index.ts";
import { DomainBadge, Highlight, Icon, LayerBadge, initial } from "./ui.tsx";

function fieldCount(table: AssetTableItem): number {
  return Number.isFinite(Number(table.fieldCount)) ? Number(table.fieldCount) : table.fields.length;
}

interface TableLayoutProps {
  tables: readonly AssetTableItem[];
  query: string;
  onOpen: (table: AssetTableItem) => void;
}

function ListLayout({ tables, query, onOpen }: TableLayoutProps) {
  const { t } = useTranslation("warehouse");
  return (
    <div className="tbl-wrap">
      <WideTableScroll ariaLabel={t("listAriaLabel")} className="asset-wide-scroll">
        <table className="dt mobile-card-table asset-wide-table">
        <thead>
          <tr>
            <th style={{ width: "32%" }}>{t("tableName")}</th>
            <th>{t("businessMeaning")}</th>
            <th style={{ width: 110 }}>{t("domain")}</th>
            <th style={{ width: 76 }}>{t("layer")}</th>
            <th style={{ width: 130 }}>{t("owner")}</th>
            <th style={{ width: 80, textAlign: "right" }}>{t("fieldCount")}</th>
          </tr>
        </thead>
        <tbody>
          {tables.map((table) => (
            <tr key={table.name} onClick={() => onOpen(table)}>
              <td data-label="">
                <div className="t-name">
                  <Icon name="table" size={15} color="var(--ink-3)" />
                  <span><Highlight text={table.name} q={query} /></span>
                  <span className="go"><Icon name="arrow" size={14} /></span>
                </div>
                {table._fieldMatch ? (
                  <div className="match-hint">
                    <Icon name="search" size={11} />{t("matchedField")} <mark>{table._fieldMatch}</mark>
                  </div>
                ) : null}
              </td>
              <td data-label={t("businessMeaning")}><span className="t-cn"><Highlight text={table.cn} q={query} /></span></td>
              <td data-label={t("domain")}><DomainBadge domain={table.domain} /></td>
              <td data-label={t("layer")}><LayerBadge layer={table.layer} /></td>
              <td data-label={t("owner")}>
                <div className="t-owner">
                  <span className="mini-av">{initial(table.owner)}</span>{table.owner}
                </div>
              </td>
              <td data-label={t("fieldCount")} style={{ textAlign: "right" }}><span className="t-num">{fieldCount(table)}</span></td>
            </tr>
          ))}
        </tbody>
        </table>
      </WideTableScroll>
    </div>
  );
}

function CardLayout({ tables, query, onOpen }: TableLayoutProps) {
  const { t } = useTranslation("warehouse");
  return (
    <CardGridView
      items={tables}
      getKey={(table) => table.name}
      onItemClick={(table) => onOpen(table)}
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
        <span className="m"><Icon name="columns" size={13} /><b>{fieldCount(table)}</b>{t("fieldCountSuffix", { count: fieldCount(table) })}</span>
      )}
    />
  );
}

function GroupLayout({ tables, query, onOpen }: TableLayoutProps) {
  const { t } = useTranslation("warehouse");
  const order = ["会员", "交易", "商品", "库存", "营销", "履约", "售后"];
  return (
    <GroupView
      items={tables}
      getKey={(table) => table.name}
      onItemClick={(table) => onOpen(table)}
      groupBy={(table) => table.domain}
      groupOrder={order}
      renderGroupLabel={(domain) => <span className="tag tag-neutral">{domain}</span>}
      renderGroupCount={(count) => t("groupTableCount", { count })}
      renderCardName={(table) => <Highlight text={table.name} q={query} />}
      renderCardBody={(table) => (
        <>
          <span><Highlight text={table.cn} q={query} /></span>
          <span className="gc-owner">{t("groupOwner", { owner: table.owner, count: fieldCount(table) })}</span>
        </>
      )}
    />
  );
}

export interface HomePageProps extends TableLayoutProps {
  layout: string;
}

export function HomePage({ tables, layout, query, onOpen }: HomePageProps) {
  const { t } = useTranslation("warehouse");
  if (tables.length === 0) {
    return <EmptyState title={t("emptyTitle")} desc={t("emptyDescription", { query })} />;
  }
  if (layout === "card") return <CardLayout tables={tables} query={query} onOpen={onOpen} />;
  if (layout === "group") return <GroupLayout tables={tables} query={query} onOpen={onOpen} />;
  return <ListLayout tables={tables} query={query} onOpen={onOpen} />;
}
