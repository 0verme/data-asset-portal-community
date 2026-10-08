import { forwardRef, type ComponentPropsWithRef, type ReactNode } from "react";
import { Grid as KumoGrid, GridItem as KumoGridItem } from "@cloudflare/kumo/components/grid";
import { LayerCard as KumoLayerCard } from "@cloudflare/kumo/components/layer-card";
import "./ui.css";

import { joinClassNames } from "./classNames.ts";
import { GRID_COLUMNS_MAP, GRID_DENSITY_MAP, type GridColumns, type GridDensity } from "./variants.ts";

type KumoSurfaceProps = ComponentPropsWithRef<typeof KumoLayerCard>;

export type SurfaceProps = KumoSurfaceProps;

const DapSurface = forwardRef<HTMLDivElement, SurfaceProps>(function DapSurface(
  { className, ...props },
  ref,
) {
  return <KumoLayerCard {...props} ref={ref} className={joinClassNames("dap-ui-surface", className)} />;
});

DapSurface.displayName = "DapSurface";

export const Surface = Object.assign(DapSurface, {
  Primary: KumoLayerCard.Primary,
  Secondary: KumoLayerCard.Secondary,
});

type KumoGridProps = ComponentPropsWithRef<typeof KumoGrid>;

export type GridProps = Omit<KumoGridProps, "gap" | "variant"> & {
  columns?: GridColumns;
  density?: GridDensity;
};

export const Grid = forwardRef<HTMLDivElement, GridProps>(function DapGrid(
  { className, columns, density = "compact", ...props },
  ref,
) {
  const variant = columns === undefined ? undefined : GRID_COLUMNS_MAP[columns];
  return (
    <KumoGrid
      {...props}
      ref={ref}
      className={joinClassNames("dap-ui-grid", className)}
      gap={GRID_DENSITY_MAP[density]}
      {...(variant ? { variant } : {})}
    />
  );
});

Grid.displayName = "DapGrid";

type KumoGridItemProps = ComponentPropsWithRef<typeof KumoGridItem>;

export const GridItem = forwardRef<HTMLDivElement, KumoGridItemProps>(function DapGridItem(
  { className, ...props },
  ref,
) {
  return <KumoGridItem {...props} ref={ref} className={joinClassNames("dap-ui-grid-item", className)} />;
});

GridItem.displayName = "DapGridItem";

export type BreadcrumbItem =
  | { kind: "link"; label: ReactNode; href: string }
  | { kind: "action"; label: ReactNode; onNavigate: () => void }
  | { kind: "text"; label: ReactNode };

export type BreadcrumbsProps = Omit<ComponentPropsWithRef<"nav">, "children"> & {
  ariaLabel?: string;
  items: readonly BreadcrumbItem[];
};

export const Breadcrumbs = forwardRef<HTMLElement, BreadcrumbsProps>(function DapBreadcrumbs(
  { ariaLabel, className, items, ...navProps },
  ref,
) {
  return (
    <nav
      {...navProps}
      ref={ref}
      aria-label={ariaLabel ?? navProps["aria-label"] ?? "面包屑"}
      className={joinClassNames("dap-ui-breadcrumbs", className)}
    >
      <ol className="dap-ui-breadcrumbs-list">
        {items.map((item, index) => {
          const isCurrent = index === items.length - 1;
          return (
            <li className="dap-ui-breadcrumbs-item" key={`${index}-${String(item.label)}`}>
              {index > 0 ? <span className="dap-ui-breadcrumbs-separator" aria-hidden="true">›</span> : null}
              {isCurrent ? (
                <span className="dap-ui-breadcrumbs-current" aria-current="page">{item.label}</span>
              ) : item.kind === "link" ? (
                <a className="dap-ui-breadcrumbs-link" href={item.href}>{item.label}</a>
              ) : item.kind === "action" ? (
                <button className="dap-ui-breadcrumbs-link" type="button" onClick={item.onNavigate}>{item.label}</button>
              ) : (
                <span className="dap-ui-breadcrumbs-text">{item.label}</span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
});

Breadcrumbs.displayName = "DapBreadcrumbs";
