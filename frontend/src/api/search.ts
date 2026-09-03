/// <reference types="vite/client" />
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

import { requestRemote } from './http.ts';
import { LONG_REQUEST_TIMEOUT } from '../config/request.ts';
import { getMenus } from './menus.ts';
import { SEARCH_SCOPE_TO_MODULE } from '../config/portalSearch.ts';
import { DWM_TABLES, type MockDwmTable } from '../data/tables.ts';
import { WORD_ROOTS, type MockWordRoot } from '../data/roots.ts';
import { UPSTREAM_SYSTEMS, type MockUpstreamSystem } from '../data/upstreamSystems.ts';
import { INDICATORS, type MockIndicatorItem } from '../data/indicators.ts';
import { PUSH_SYSTEMS, type PushSystemItem, type PushJobItem } from '../data/pushSystems.ts';
import { REPORTS, type MockReportItem } from '../data/reports.ts';
import { API_ASSETS, type MockApiAsset } from '../data/apiAssets.ts';
import { MANUAL_CODE_TABLES, type MockManualCodeTable } from '../data/manualCodeTables.ts';

const API_MODE = (
  typeof import.meta !== 'undefined' && import.meta.env?.['VITE_API_MODE']
    ? String(import.meta.env['VITE_API_MODE'])
    : 'mock'
).trim().toLowerCase();

const SCOPE_ALL = 'all';
const SCOPE_ALIASES: Record<string, string> = { metric: 'indicator', push: 'downstream', apiAsset: 'api' };
const DEFAULT_LIMIT = 5;
const REMOTE_SEARCH_TIMEOUT_MS = LONG_REQUEST_TIMEOUT;

export interface MatchedFieldItem {
  label: string;
  value: string;
}

export interface SearchResultItem {
  id: string;
  title: string;
  subtitle: string;
  meta: string;
  module: string;
  ref: unknown;
  type: string;
  category: string;
  matchedFields: MatchedFieldItem[];
}

export interface SearchResultGroup {
  type: string;
  label: string;
  module: string;
  count: number;
  items: SearchResultItem[];
}

export interface SearchResult {
  query: string;
  scope: string;
  groups: SearchResultGroup[];
  total: number;
}

export async function unifiedSearch(
  query: string,
  scope = SCOPE_ALL,
  limit = DEFAULT_LIMIT,
): Promise<SearchResult> {
  const keyword = String(query || '').trim();
  const normalizedScope = SCOPE_ALIASES[scope] || scope || SCOPE_ALL;

  if (API_MODE === 'remote') {
    return requestRemote<SearchResult>('/search', {
      params: { q: keyword, scope: normalizedScope, limit },
      timeout: REMOTE_SEARCH_TIMEOUT_MS,
    });
  }
  return mockSearch(keyword, normalizedScope, limit);
}

function makeItem(
  type: string,
  category: string,
  module: string,
  id: string,
  title: string,
  subtitle: string,
  meta: string,
  ref: unknown,
  matchedFields: MatchedFieldItem[] = [],
): SearchResultItem {
  return { id, title, subtitle, meta, module, ref, type, category, matchedFields };
}

function toSearchString(value: unknown): string {
  return String(value ?? '').toLowerCase();
}

interface EntityField<T> {
  label: string;
  getValue: (row: T) => unknown;
}

function findFirstMatch<T>(row: T, fields: readonly EntityField<T>[], needle: string): MatchedFieldItem | null {
  for (const field of fields) {
    const value = String(field.getValue(row) ?? '');
    if (value.toLowerCase().includes(needle)) {
      return { label: field.label, value };
    }
  }
  return null;
}

interface SearchEntity {
  type: string;
  label: string;
  module: string;
  search: (needle: string, limit: number) => { count: number; items: SearchResultItem[] };
}

function createSearchEntity<T>(
  type: string,
  label: string,
  module: string,
  source: () => readonly T[],
  fields: readonly EntityField<T>[],
  map: (row: T, matchedFields: MatchedFieldItem[]) => SearchResultItem,
): SearchEntity {
  return {
    type,
    label,
    module,
    search(needle: string, limit: number) {
      const matched = source().flatMap((row) => {
        const firstMatch = findFirstMatch(row, fields, needle);
        return firstMatch ? [{ row, matchedFields: [firstMatch] }] : [];
      });
      return {
        count: matched.length,
        items: matched.slice(0, limit).map(({ row, matchedFields }) => map(row, matchedFields)),
      };
    },
  };
}

interface FieldSearchRow {
  name: string;
  cn: string;
  table: string;
  tableCn: string;
  owner: string;
}

interface PushJobSearchRow extends PushJobItem {
  system?: PushSystemItem | undefined;
}

const MOCK_ENTITIES: readonly SearchEntity[] = [
  createSearchEntity<MockDwmTable>(
    'asset',
    '资产',
    'dwm',
    () => DWM_TABLES,
    [
      { label: '资产表', getValue: (row) => row.name },
      { label: '资产中文名', getValue: (row) => row.cn },
      { label: '主题域', getValue: (row) => row.domain },
      { label: '分层', getValue: (row) => row.layer },
      { label: '负责人', getValue: (row) => row.owner },
      { label: '描述', getValue: (row) => row.desc },
      { label: '粒度', getValue: (row) => row.grain },
      { label: '周期', getValue: (row) => row.cycle },
    ],
    (row, matchedFields) =>
      makeItem(
        'asset',
        '资产',
        'dwm',
        row.name,
        row.name || '',
        row.cn || '',
        [row.domain, row.layer, row.owner].filter(Boolean).join(' / '),
        row.name,
        matchedFields,
      ),
  ),
  createSearchEntity<MockUpstreamSystem>(
    'system',
    '系统',
    'upstream',
    () => UPSTREAM_SYSTEMS,
    [
      { label: '系统简称', getValue: (row) => row.abbr },
      { label: '系统名称', getValue: (row) => row.name },
      { label: '主机', getValue: (row) => row.host },
      { label: '数据库', getValue: (row) => row.db },
      { label: '系统编码', getValue: (row) => row.id },
      { label: '负责人', getValue: (row) => row.owner },
    ],
    (row, matchedFields) =>
      makeItem(
        'system',
        '系统',
        'upstream',
        row.id,
        row.abbr || row.name || '',
        row.name || '',
        row.host || '',
        row.id,
        matchedFields,
      ),
  ),
  createSearchEntity<FieldSearchRow>(
    'field',
    '字段',
    'mapping',
    () =>
      DWM_TABLES.flatMap((table) =>
        (table.fields || []).map((field) => ({
          name: field.name,
          cn: field.cn,
          table: table.name,
          tableCn: table.cn,
          owner: table.owner,
        })),
      ),
    [
      { label: '源字段', getValue: (row) => row.name },
      { label: '字段注释', getValue: (row) => row.cn },
      { label: '源表', getValue: (row) => row.table },
      { label: '源表中文名', getValue: (row) => row.tableCn },
      { label: '负责人', getValue: (row) => row.owner },
    ],
    (row, matchedFields) =>
      makeItem(
        'field',
        '字段',
        'mapping',
        `${row.table}.${row.name}`,
        row.name || '',
        row.cn || '',
        row.table || '',
        row.table,
        matchedFields,
      ),
  ),
  createSearchEntity<MockWordRoot>(
    'root',
    '词根',
    'root',
    () => WORD_ROOTS,
    [
      { label: '词根缩写', getValue: (row) => row.abbr },
      { label: '英文名', getValue: (row) => row.en },
      { label: '中文名', getValue: (row) => row.cn },
      { label: '分类', getValue: (row) => row.cat },
      { label: '说明', getValue: (row) => row.desc },
    ],
    (row, matchedFields) =>
      makeItem(
        'root',
        '词根',
        'root',
        row.abbr,
        row.abbr || '',
        row.cn || row.en || '',
        row.cat || '',
        row.abbr,
        matchedFields,
      ),
  ),
  createSearchEntity<MockIndicatorItem>(
    'indicator',
    '指标',
    'indicator',
    () => INDICATORS,
    [
      { label: '指标ID', getValue: (row) => row.id },
      { label: '指标名称', getValue: (row) => row.name },
      { label: '业务含义', getValue: (row) => row.meaning },
      { label: '结果表', getValue: (row) => row.resultTableName },
      { label: '结果字段', getValue: (row) => row.resultFieldName },
      { label: '口径', getValue: (row) => row.caliber },
      { label: '路径', getValue: (row) => row.path },
      { label: '维护人', getValue: (row) => row.registrar },
    ],
    (row, matchedFields) =>
      makeItem(
        'indicator',
        '指标',
        'indicator',
        row.id,
        row.id || '',
        row.name || '',
        row.meaning || '',
        row.id,
        matchedFields,
      ),
  ),
  createSearchEntity<PushJobSearchRow>(
    'downstream',
    '下游推送',
    'push',
    () =>
      PUSH_SYSTEMS.flatMap((system) =>
        (system.jobs || []).map((job) => ({ ...job, system } as PushJobSearchRow)),
      ),
    [
      { label: '系统编码', getValue: (row) => row.system?.id },
      { label: '系统简称', getValue: (row) => row.system?.abbr },
      { label: '系统名称', getValue: (row) => row.system?.name },
      { label: '主机', getValue: (row) => row.system?.host },
      { label: '联系人', getValue: (row) => row.system?.downstreamContact },
      { label: '作业名称', getValue: (row) => row.cn },
      { label: '作业编码', getValue: (row) => row.id },
      { label: '源路径', getValue: (row) => row.sourcePath },
      { label: '源文件名', getValue: (row) => row.sourceFileName },
      { label: '目标路径', getValue: (row) => row.targetPath },
      { label: '目标文件名', getValue: (row) => row.targetFileName },
      { label: '负责人', getValue: (row) => row.system?.dataDeveloperContact },
      { label: '作业描述', getValue: (row) => row.desc },
    ],
    (row, matchedFields) =>
      makeItem(
        'downstream',
        '下游推送',
        'push',
        `${row.system?.id || ''}.${row.id}`,
        row.cn || row.id || '',
        row.system?.name || row.system?.id || '',
        [row.sourceFileName, row.targetFileName, row.targetPath || row.sourcePath].filter(Boolean).join(' / '),
        { systemId: row.system?.id, jobId: row.id },
        matchedFields,
      ),
  ),
  createSearchEntity<MockReportItem>(
    'report',
    '报表',
    'report',
    () => REPORTS,
    [
      { label: '报表编码', getValue: (row) => row.code },
      { label: '报表名称', getValue: (row) => row.name },
      { label: '报表别名', getValue: (row) => row.alias },
      { label: '报表类型', getValue: (row) => row.type },
      { label: '主题域', getValue: (row) => row.domain },
      { label: '用途', getValue: (row) => row.purpose },
      { label: '归属部门', getValue: (row) => row.ownerDept },
      { label: '负责人', getValue: (row) => row.ownerName },
      { label: '维护人', getValue: (row) => row.maintainerName },
    ],
    (row, matchedFields) =>
      makeItem(
        'report',
        '报表',
        'report',
        row.code,
        row.code || '',
        row.name || row.alias || '',
        [row.type, row.ownerDept, row.ownerName].filter(Boolean).join(' / '),
        row.code,
        matchedFields,
      ),
  ),
  createSearchEntity<MockApiAsset>(
    'api',
    'API',
    'apiAsset',
    () => API_ASSETS,
    [
      { label: 'API编码', getValue: (row) => row.code },
      { label: 'API名称', getValue: (row) => row.name },
      { label: '路径', getValue: (row) => row.path },
      { label: '方法', getValue: (row) => row.method },
      { label: '描述', getValue: (row) => row.description },
      { label: '归属部门', getValue: (row) => row.ownerDept },
      { label: '负责人', getValue: (row) => row.ownerName },
      { label: '维护人', getValue: (row) => row.maintainerName },
    ],
    (row, matchedFields) =>
      makeItem(
        'api',
        'API',
        'apiAsset',
        row.code,
        row.code || '',
        row.name || '',
        [row.method, row.path, row.ownerName].filter(Boolean).join(' / '),
        row.code,
        matchedFields,
      ),
  ),
  createSearchEntity<MockManualCodeTable>(
    'codeTable',
    '码值表',
    'codeTable',
    () => MANUAL_CODE_TABLES,
    [
      { label: '表编码', getValue: (row) => row.tableCode },
      { label: '表名称', getValue: (row) => row.tableName },
      { label: '样式', getValue: (row) => row.style },
      { label: '负责人', getValue: (row) => row.owner },
      { label: '说明', getValue: (row) => row.remark },
    ],
    (row, matchedFields) =>
      makeItem(
        'codeTable',
        '码值表',
        'codeTable',
        row.tableCode,
        row.tableCode || '',
        row.tableName || '',
        [row.style, row.owner].filter(Boolean).join(' / '),
        row.tableCode,
        matchedFields,
      ),
  ),
];

async function getEnabledMenuCodes(): Promise<Set<string>> {
  const menus = await getMenus();
  return new Set(
    (Array.isArray(menus) ? menus : [])
      .filter((item) => item?.status !== 'disabled')
      .map((item) => String(item.code || '').trim())
      .filter(Boolean),
  );
}

async function mockSearch(keyword: string, scope: string, limit: number): Promise<SearchResult> {
  if (!keyword) {
    return { query: '', scope, groups: [], total: 0 };
  }

  const needle = toSearchString(keyword);
  const safeLimit = Math.min(Math.max(Number(limit) || DEFAULT_LIMIT, 1), 50);
  const enabledMenuCodes = await getEnabledMenuCodes();
  const entities = (
    scope === SCOPE_ALL ? MOCK_ENTITIES : MOCK_ENTITIES.filter((entity) => entity.type === scope)
  ).filter((entity) => {
    const moduleKey = SEARCH_SCOPE_TO_MODULE[entity.type as keyof typeof SEARCH_SCOPE_TO_MODULE] || entity.module;
    return enabledMenuCodes.has(moduleKey);
  });

  const groups: SearchResultGroup[] = entities.map((entity) => {
    const { count, items } = entity.search(needle, safeLimit);
    return {
      type: entity.type,
      label: entity.label,
      module: entity.module,
      count,
      items,
    };
  });

  const visibleGroups = scope === SCOPE_ALL ? groups.filter((group) => group.count > 0) : groups;
  const total = visibleGroups.reduce((sum, group) => sum + group.count, 0);

  return { query: keyword, scope, groups: visibleGroups, total };
}
