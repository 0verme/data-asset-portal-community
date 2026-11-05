import { useEffect, useMemo, useState } from "react";

import {
  getFieldMappingSourceSystems,
  type FieldMappingSourceSystemOption,
} from "../../api/fieldMapping.ts";
import type { MappingRoute } from "../../routing/types.ts";
import { Button, Input } from "../../ui/index.ts";
import { Icon } from "../ui.tsx";
import { formatSystemLabel, getRouteSourceSystemId } from "../fieldMapping/fieldMappingUtils.ts";

interface MappingSidebarProps {
  route: MappingRoute;
  setRoute: (value: MappingRoute | ((current: MappingRoute) => MappingRoute)) => void;
}

function sourceSystemName(system: FieldMappingSourceSystemOption): string {
  return String(system.name || system.systemName || "").trim();
}

function sourceSystemCode(system: FieldMappingSourceSystemOption): string {
  return String(system.systemCode || system.systemAbbr || "").trim();
}

export function MappingSidebar({ route, setRoute }: MappingSidebarProps) {
  const [sourceSystems, setSourceSystems] = useState<FieldMappingSourceSystemOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retryVersion, setRetryVersion] = useState(0);
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");

    async function loadSourceSystems(): Promise<void> {
      try {
        const items = await getFieldMappingSourceSystems();
        if (cancelled) return;
        setSourceSystems(items);
      } catch (loadError: unknown) {
        if (cancelled) return;
        setSourceSystems([]);
        setError(loadError instanceof Error ? loadError.message : "源系统清单加载失败");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadSourceSystems();
    return () => {
      cancelled = true;
    };
  }, [retryVersion]);

  const filteredSystems = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    if (!query) return sourceSystems;
    return sourceSystems.filter((system) => (
      `${sourceSystemName(system)} ${sourceSystemCode(system)}`
        .toLocaleLowerCase()
        .includes(query)
    ));
  }, [search, sourceSystems]);

  const selectedSourceSystemId = String(getRouteSourceSystemId(route) || "");
  const selectSourceSystem = (sourceSystemId: string) => {
    setRoute((current) => {
      const currentSourceSystemId = String(getRouteSourceSystemId(current) || "");
      const hasRouteTableFilter = Boolean(current.sourceTable || current.dwfTable || current.tablePk);
      if (currentSourceSystemId === sourceSystemId && !hasRouteTableFilter) return current;
      return {
        ...current,
        sourceSystemId,
        upstreamSystemId: "",
        // A table-detail deep link is narrower than the navigator selection.
        // Keep the visible table-name conditions in the query form, but remove
        // route-only identity constraints when changing the source system.
        sourceTable: "",
        dwfTable: "",
        tablePk: "",
      };
    });
  };

  return (
    <section className="mapping-sidebar side-group" aria-label="源系统导航">
      <div className="mapping-sidebar-heading">
        <div className="side-title">源系统导航</div>
        <button
          className="mapping-sidebar-toggle"
          type="button"
          aria-label={expanded ? "收起源系统导航" : "展开源系统导航"}
          aria-expanded={expanded}
          onClick={() => setExpanded((current) => !current)}
        >
          <Icon name="chevron" size={14} />
        </button>
      </div>
      {expanded ? (
        <>
          <Input
            aria-label="搜索源系统"
            className="mapping-sidebar-search"
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="搜索名称或编码"
          />
          <nav className="mapping-system-list" aria-label="源系统列表">
            <button
              className={`side-item mapping-system-item${selectedSourceSystemId ? "" : " active"}`}
              type="button"
              aria-label="全部源系统"
              aria-pressed={!selectedSourceSystemId}
              onClick={() => selectSourceSystem("")}
            >
              <span className="mapping-system-name">全部源系统</span>
            </button>
            {loading ? (
              <div className="mapping-system-state" role="status">正在加载源系统…</div>
            ) : error ? (
              <div className="mapping-system-state mapping-system-error" role="alert">
                <span>源系统清单加载失败</span>
                <Button
                  className="mapping-system-retry"
                  variant="tertiary"
                  size="sm"
                  type="button"
                  onClick={() => setRetryVersion((current) => current + 1)}
                >
                  重试
                </Button>
              </div>
            ) : sourceSystems.length === 0 ? (
              <div className="mapping-system-state">暂无可用源系统</div>
            ) : filteredSystems.length === 0 ? (
              <div className="mapping-system-state">没有匹配的源系统</div>
            ) : filteredSystems.map((system) => {
              const sourceSystemId = String(system.sourceSystemId ?? system.id ?? system.upstreamSystemId);
              const name = sourceSystemName(system) || sourceSystemCode(system);
              const code = sourceSystemCode(system);
              const label = formatSystemLabel(system);
              const selected = selectedSourceSystemId === sourceSystemId;
              return (
                <button
                  key={sourceSystemId}
                  className={`side-item mapping-system-item${selected ? " active" : ""}`}
                  type="button"
                  aria-label={label}
                  aria-pressed={selected}
                  title={label}
                  onClick={() => selectSourceSystem(sourceSystemId)}
                >
                  <span className="mapping-system-name" title={name}>{name}</span>
                  {code ? <span className="mapping-system-code">{code}</span> : null}
                </button>
              );
            })}
          </nav>
        </>
      ) : null}
    </section>
  );
}
