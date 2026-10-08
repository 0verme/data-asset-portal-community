import { createContext, useContext, useLayoutEffect, useState, type RefObject } from "react";
import type { PortalContainer } from "@cloudflare/kumo";

export type OverlayContainerRef = RefObject<HTMLElement | null>;

export const OverlayContainerContext = createContext<OverlayContainerRef | null>(null);

let overlayRoot: HTMLDivElement | null = null;

export function ensureOverlayRoot(): HTMLDivElement | null {
  if (typeof document === "undefined" || !document.body) return null;
  if (overlayRoot?.isConnected) return overlayRoot;

  const existing = document.getElementById("dap-ui-overlay-root");
  if (existing) {
    if (!(existing instanceof HTMLDivElement)) return null;
    overlayRoot = existing;
    return overlayRoot;
  }

  overlayRoot = document.createElement("div");
  overlayRoot.id = "dap-ui-overlay-root";
  overlayRoot.dataset["dapUiOverlayRoot"] = "";
  document.body.appendChild(overlayRoot);
  return overlayRoot;
}

export function useOverlayPortalRoot(): HTMLElement | null {
  const [root, setRoot] = useState<HTMLElement | null>(null);

  useLayoutEffect(() => {
    setRoot(ensureOverlayRoot());
  }, []);

  return root;
}

export function useOverlayContainer(explicit?: PortalContainer): PortalContainer | null {
  const inherited = useContext(OverlayContainerContext);
  const root = useOverlayPortalRoot();
  return explicit ?? inherited ?? root;
}
