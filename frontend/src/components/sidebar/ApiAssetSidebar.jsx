import { SidebarActionGroup } from "./common/SidebarActionGroup.jsx";
import { SidebarFilterGroup } from "./common/SidebarFilterGroup.jsx";
import { StatusFilterGroup } from "./common/StatusFilterGroup.jsx";

export function ApiAssetSidebar({ apiAsset, filter, setFilter, requireLogin, canEdit = false }) {
  const group = (title, key, items) => <SidebarFilterGroup title={title} items={items.map(({ value, count, label }) => ({ key: value, label, count, active: String(filter[key]) === String(value), onClick: () => setFilter((previous) => ({ ...previous, [key]: previous[key] === value ? null : value })) }))} />;
  return <>{group("请求方式", "method", Object.entries(apiAsset.facets.method).sort().map(([value, count]) => ({ value, count, label: value })))}{group("业务系统", "downstreamSystemId", apiAsset.systems.filter((system) => apiAsset.facets.downstreamSystemId[system.id]).map((system) => ({ value: String(system.id), count: apiAsset.facets.downstreamSystemId[system.id], label: system.name })))}<StatusFilterGroup value={filter.status} onChange={(status) => setFilter((previous) => ({ ...previous, status }))} totalCount={apiAsset.items.length} enabledCount={apiAsset.facets.status.enabled || 0} disabledCount={apiAsset.facets.status.disabled || 0} allValue={null} /><SidebarActionGroup actions={canEdit ? [{ key: "create-api", label: "新增 API", onClick: () => requireLogin(apiAsset.create) }] : []} /></>;
}
