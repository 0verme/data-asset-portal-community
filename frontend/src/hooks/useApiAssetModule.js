import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { deleteApiAsset, getApiAssets, getApiDownstreamSystems, saveApiAsset, setApiAssetStatus } from "../api/apiAssets.js";
import { DEFAULT_API_ASSET_ROUTE } from "../config/defaults.ts";
import { getErrorMessage, scrollMainToTop } from "../utils/ui.ts";
import { toast } from "../components/common/index.js";
import { runOptimisticStatusMutation } from "../utils/statusMutation.ts";

export function useApiAssetModule({ active, query, route, setRoute, filter, canEdit, requireLogin, setAuthError, setLoginOpen }) {
  const [items, setItems] = useState([]);
  const [systems, setSystems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [pendingIds, setPendingIds] = useState([]);
  const pendingRef = useRef(new Set());
  const load = useCallback(async () => {
    setLoading(true);
    try { const [nextItems, nextSystems] = await Promise.all([getApiAssets(), getApiDownstreamSystems()]); setItems(nextItems); setSystems(nextSystems); setError(""); }
    catch (e) { setError(e.message || "加载 API 资产失败"); }
    finally { setLoaded(true); setLoading(false); }
  }, []);
  useEffect(() => { if (active && !loaded && !loading) load(); }, [active, loaded, loading, load]);
  const filtered = useMemo(() => items.filter((x) => {
    const q = query.trim().toLowerCase();
    return (!filter.status || x.status === filter.status) && (!filter.method || x.method === filter.method) && (!filter.downstreamSystemId || String(x.downstreamSystemId) === String(filter.downstreamSystemId)) && (!q || [x.code, x.name, x.path, x.description, x.ownerName, x.ownerDept, x.downstreamSystemName, x.downstreamSystemShortName].some((v) => String(v || "").toLowerCase().includes(q)));
  }), [items, filter, query]);
  const facets = useMemo(() => items.reduce((result, item) => { ["status", "method"].forEach((key) => { result[key][item[key]] = (result[key][item[key]] || 0) + 1; }); if (item.downstreamSystemId != null) result.downstreamSystemId[item.downstreamSystemId] = (result.downstreamSystemId[item.downstreamSystemId] || 0) + 1; return result; }, { status: {}, method: {}, downstreamSystemId: {} }), [items]);
  const current = items.find((x) => x.code === route.code) || null;
  const guard = (fn) => requireLogin(() => fn());
  const save = async (payload) => { if (!canEdit) { setAuthError(""); setLoginOpen(true); return; } try { await saveApiAsset(route.page === "edit" ? route.code : null, payload); await load(); setRoute(DEFAULT_API_ASSET_ROUTE); scrollMainToTop(); } catch (e) { setSaveError(e.message || "保存失败"); } };
  const toggle = async (item) => { if (!canEdit) { setAuthError(""); setLoginOpen(true); return; } if (pendingRef.current.has(item.code)) return; pendingRef.current.add(item.code); const nextStatus = item.status === "enabled" ? "disabled" : "enabled"; setPendingIds((currentIds) => [...currentIds, item.code]); await runOptimisticStatusMutation({ apply: () => setItems((currentItems) => currentItems.map((row) => row.code === item.code ? { ...row, status: nextStatus } : row)), request: () => setApiAssetStatus(item.code, nextStatus), rollback: () => setItems((currentItems) => currentItems.map((row) => row.code === item.code ? item : row)), onError: (e) => toast.error(getErrorMessage(e, "更新 API 资产状态失败。")) }); pendingRef.current.delete(item.code); setPendingIds((currentIds) => currentIds.filter((code) => code !== item.code)); };
  return { items, systems, loading, error, load, filtered, facets, current, saveError, setSaveError, pendingIds, create: () => guard(() => setRoute({ page: "new", code: null })), edit: (code) => guard(() => setRoute({ page: "edit", code })), view: (code) => setRoute({ page: "view", code }), back: () => { setRoute(DEFAULT_API_ASSET_ROUTE); scrollMainToTop(); }, save, remove: async (code) => { await deleteApiAsset(code); await load(); setRoute(DEFAULT_API_ASSET_ROUTE); }, toggle };
}
