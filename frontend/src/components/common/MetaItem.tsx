import type { ReactNode } from "react";

export interface MetaItemProps {
  label: ReactNode;
  value: ReactNode;
  mono?: boolean | undefined;
}

export function MetaItem({ label, value, mono = false }: MetaItemProps) {
  return (
    <div className="mi">
      <div className="k">{label}</div>
      <div className={`v${mono ? " mono" : ""}`}>{value}</div>
    </div>
  );
}
