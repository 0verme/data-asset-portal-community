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

import React, { type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import type { AssetTableField, AssetTableItem } from "../api/assets.ts";
import { Button, Input, Tabs } from "../ui/index.ts";
import { getAssetFieldCount } from "../utils/assetFieldCount.ts";
import { getQualifiedAssetTableName } from "../utils/assetTableName.ts";
import { getWarehouseDomainLabel } from "./warehouseLabels.ts";
import { AssetRisksPanel } from "./AssetRisksPanel.tsx";
import { MetaItem, PageHeader } from "./common/index.ts";
import { DomainBadge, Highlight, Icon, LayerBadge, initial } from "./ui.tsx";

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

function renderDDLLine(line: string, index: number): ReactNode {
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

  const tokens: ReactNode[] = [];
  const regex = /('(?:[^'\\]|\\.)*'|[A-Z_]+(?:\(\d+(?:,\s*\d+)?\))?|[a-zA-Z_][\w.]*|\s+|[(),;=])/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
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

function renderDDL(ddl: string): ReactNode {
  return ddl.split("\n").map((line, index, lines) => (
    <React.Fragment key={`line-${index}`}>
      {renderDDLLine(line, index)}
      {index < lines.length - 1 ? "\n" : null}
    </React.Fragment>
  ));
}

interface DDLViewProps {
  asset: AssetTableItem;
  ddl: string;
  ddlDialectLabel: string;
}

function DDLView({ asset, ddl, ddlDialectLabel }: DDLViewProps) {
  const { t } = useTranslation("warehouse");
  const [copied, setCopied] = React.useState(false);

  const copy = async () => {
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(ddl);
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div className="ddl-wrap">
      <div className="ddl-bar">
        <span className="ddl-lang"><span className="d"></span>{ddlDialectLabel} · {t("createTableStatement")}</span>
        <Button className={`btn${copied ? " copied" : ""}`} size="sm" type="button" variant="secondary" onClick={() => void copy()} style={{ height: 30 }}>
          <Icon name={copied ? "check" : "copy"} size={14} />{copied ? t("copied") : t("copyDdl")}
        </Button>
      </div>
      <pre className="ddl" aria-label={t("ddlForTable", { tableName: asset.name })}>
        <code className="ddl-code">{renderDDL(ddl)}</code>
      </pre>
    </div>
  );
}

function EnumCell({ field }: { field: AssetTableField }) {
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

interface FieldsViewProps {
  fields: readonly AssetTableField[];
}

function FieldsView({ fields }: FieldsViewProps) {
  const { t } = useTranslation("warehouse");
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
          <Input
            aria-label={t("filterFields")}
            placeholder={t("filterFields")}
            value={fieldQuery}
            onChange={(event) => setFieldQuery(event.target.value)}
          />
        </div>
        <span className="ft-info">
          {t("fieldCountValue", { count: fields.length })}
          {normalizedQuery ? ` · ${t("fieldMatchCount", { count: rows.length })}` : ""}
        </span>
      </div>
      <div className="field-table-scroll">
        <table className="fields">
          <thead>
            <tr>
              <th className="c-idx">#</th>
              <th>{t("fieldName")}</th>
              <th>{t("fieldComment")}</th>
              <th style={{ width: 130 }}>{t("fieldType")}</th>
              <th style={{ width: 80 }}>{t("nullable")}</th>
              <th>{t("enumDescription")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.length ? rows.map((field) => (
              <tr
                key={field.fieldId != null ? `field:${field.fieldId}` : field.name}
                id={field.fieldId != null ? `asset-field-${field.fieldId}` : undefined}
                tabIndex={field.fieldId != null ? -1 : undefined}
              >
                <td className="c-idx">{fields.findIndex((item) => item.name === field.name) + 1}</td>
                <td className="c-name">
                  <Highlight text={field.name} q={fieldQuery} />
                  {(field.pk || field.part) ? (
                    <span className="keys">
                      {field.pk ? <span className="key-tag key-pk">PK</span> : null}
                      {field.part ? <span className="key-tag key-part">{t("partition")}</span> : null}
                    </span>
                  ) : null}
                </td>
                <td className="c-cn"><Highlight text={field.cn} q={fieldQuery} /></td>
                <td className="c-type">{field.type}</td>
                <td className="c-null">{field.nullable ? <span className="null-yes">{t("nullable")}</span> : <span className="null-no">NOT NULL</span>}</td>
                <td className="c-enum"><EnumCell field={field} /></td>
              </tr>
            )) : (
              <tr className="asset-field-empty-row">
                <td colSpan={6}>{normalizedQuery ? t("fieldSearchEmpty", { query: fieldQuery }) : t("noFields")}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export interface DetailPageProps {
  asset: AssetTableItem;
  fields: readonly AssetTableField[];
  ddl: string;
  ddlDialectLabel: string;
  tab: string;
  onTabChange: (tab: string) => void;
  onBack: () => void;
  onBackToList: () => void;
  onEdit?: (() => void) | undefined;
}

export function DetailPage({
  asset,
  fields,
  ddl,
  ddlDialectLabel,
  tab,
  onTabChange,
  onBack,
  onBackToList,
  onEdit,
}: DetailPageProps) {
  const [copied, setCopied] = React.useState(false);
  const storageTableName = getQualifiedAssetTableName(asset.name, asset.schema);
  const fieldCount = getAssetFieldCount(asset.fieldCount);

  const copyName = async () => {
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(storageTableName);
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };
  const assetRisks = asset["assetRisks"];
  const { t } = useTranslation("warehouse");

  return (
    <div className="asset-detail-page">
      <PageHeader
        back={{ onClick: onBack, text: t("backToList") }}
        breadcrumbs={[
          { label: t("menus.dwm", { ns: "navigation" }), onClick: onBackToList },
          { label: asset.name },
        ]}
      />

      <div className="detail-head">
        <div className="dh-top">
          <div>
            <div className="dh-title">
              <Icon name="table" size={22} color="var(--ink-2)" />
              <h1 className="dh-en">{asset.name}</h1>
              <DomainBadge domain={getWarehouseDomainLabel(asset.domain, t)} />
              <LayerBadge layer={asset.layer} />
            </div>
            <div className="dh-cn">{asset.cn}</div>
            <div className="dh-desc">{asset.desc}</div>
          </div>
          <div className="dh-actions">
            {onEdit ? <Button className="btn" type="button" variant="secondary" onClick={onEdit}>
              <Icon name="edit" size={15} />{t("editTable")}
            </Button> : null}
            <Button className={`btn${copied ? " copied" : ""}`} type="button" variant="secondary" onClick={() => void copyName()}>
              <Icon name={copied ? "check" : "copy"} size={15} />{copied ? t("copied") : t("copyTableName")}
            </Button>
            <Button className="btn primary" type="button" variant="primary" onClick={() => onTabChange("ddl")}>
              <Icon name="code" size={15} />{t("viewDdl")}
            </Button>
          </div>
        </div>
        <div className="dh-meta">
          <MetaItem label={t("owner")} value={<><span className="mini-av" style={{ width: 22, height: 22 }}>{initial(asset.owner)}</span>{asset.owner || t("notSpecified")}</>} />
          <MetaItem label={t("grain")} value={asset.grain || t("notSpecified")} />
          <MetaItem label={t("updateCycle")} value={<><Icon name="clock" size={14} color="var(--ink-3)" />{asset.cycle || t("notSpecified")}</>} />
          <MetaItem label={t("fieldCount")} value={fieldCount === null ? t("unknown") : t("fieldCountValue", { count: fieldCount })} mono />
          <MetaItem label={t("storageTable")} value={storageTableName} mono />
        </div>
      </div>

      <AssetRisksPanel assetRisks={Array.isArray(assetRisks) ? assetRisks : []} />

      <Tabs
        aria-label={t("detailTabs")}
        appearance="line"
        className="asset-detail-tabs"
        size="md"
        value={tab}
        onValueChange={onTabChange}
        tabs={[
          {
            value: "fields",
            label: (
              <span className="asset-detail-tab-label">
                <Icon name="table" size={14} />
                <span>{t("fieldsTab")}</span>
                <span className="asset-detail-tab-count" aria-label={t("fieldCountValue", { count: fields.length })}>{fields.length}</span>
              </span>
            ),
          },
          {
            value: "ddl",
            label: (
              <span className="asset-detail-tab-label">
                <Icon name="code" size={14} />
                <span>{t("createTableStatement")}</span>
              </span>
            ),
          },
        ]}
      />
      <div className="panel asset-detail-panel">
        {tab === "fields" ? <FieldsView fields={fields} /> : <DDLView asset={asset} ddl={ddl} ddlDialectLabel={ddlDialectLabel} />}
      </div>
    </div>
  );
}
