import { useEffect, type MouseEventHandler, type ReactNode } from "react";
import { Banner as KumoBanner } from "@cloudflare/kumo/components/banner";
import { Empty as KumoEmpty } from "@cloudflare/kumo/components/empty";
import { Loader as KumoLoader } from "@cloudflare/kumo/components/loader";
import { Toasty, createKumoToastManager } from "@cloudflare/kumo/components/toast";
import type { ComponentProps } from "react";
import { Button } from "./Button.tsx";
import { joinClassNames } from "./classNames.ts";
import { DEFAULT_TOAST_DURATION, resolveToastDuration } from "./toastConfig.ts";
import {
  ensureOverlayRoot,
  useOverlayPortalRoot,
} from "./overlayPortal.ts";
import "./feedback.css";

export type ToastTone = "success" | "error" | "warning" | "info";

export interface ToastOptions {
  duration?: number | undefined;
}

export { DEFAULT_TOAST_DURATION, resolveToastDuration };

const toastManager = createKumoToastManager();
let mountedToastHosts = 0;

function emitToast(message: unknown, tone: ToastTone, options: ToastOptions = {}): void {
  const text = typeof message === "string" ? message : String(message ?? "");
  if (mountedToastHosts === 0) {
    if (typeof window !== "undefined") window.alert(text);
    return;
  }

  toastManager.add({
    title: text,
    variant: tone,
    timeout: resolveToastDuration(options.duration),
    priority: tone === "error" ? "high" : "low",
  });
}

export const toast = {
  success: (message: unknown, options?: ToastOptions): void => emitToast(message, "success", options),
  error: (message: unknown, options?: ToastOptions): void => emitToast(message, "error", options),
  warning: (message: unknown, options?: ToastOptions): void => emitToast(message, "warning", options),
  info: (message: unknown, options?: ToastOptions): void => emitToast(message, "info", options),
};

export interface ToastHostProps {
  children?: ReactNode;
}

export function ToastHost({ children }: ToastHostProps) {
  const portalRoot = useOverlayPortalRoot();
  useEffect(() => {
    // Ensure the shared portal exists even if a toast is dispatched immediately after mount.
    if (!ensureOverlayRoot()) return undefined;
    mountedToastHosts += 1;
    return () => {
      mountedToastHosts = Math.max(0, mountedToastHosts - 1);
      if (mountedToastHosts === 0) toastManager.close();
    };
  }, []);

  if (!portalRoot) return <>{children}</>;
  return (
    <>
      <Toasty container={portalRoot} toastManager={toastManager}>{null}</Toasty>
      {children}
    </>
  );
}

export type BannerTone = "info" | "warning" | "error" | "neutral";
type KumoBannerProps = ComponentProps<typeof KumoBanner>;

export type BannerProps = Omit<KumoBannerProps, "variant"> & {
  tone?: BannerTone | undefined;
};

const BANNER_VARIANTS: Record<BannerTone, NonNullable<KumoBannerProps["variant"]>> = {
  info: "default",
  warning: "alert",
  error: "error",
  neutral: "secondary",
};

export function Banner({ tone = "info", className, role, ...props }: BannerProps) {
  return (
    <KumoBanner
      {...props}
      role={role ?? (tone === "error" ? "alert" : "status")}
      variant={BANNER_VARIANTS[tone]}
      className={joinClassNames("dap-ui-banner", className)}
    />
  );
}

export interface LoadingStateProps {
  title: ReactNode;
  desc: ReactNode;
  className?: string | undefined;
  label?: string | undefined;
}

export function LoadingState({ title, desc, className, label = "正在加载" }: LoadingStateProps) {
  return (
    <div className={joinClassNames("dap-ui-loading-state", className)} role="status" aria-live="polite">
      <KumoLoader aria-label={label} />
      <h3>{title}</h3>
      <p>{desc}</p>
    </div>
  );
}

export interface EmptyStateProps {
  title: string;
  desc?: string | undefined;
  actionText?: string | undefined;
  onAction?: MouseEventHandler<HTMLButtonElement> | undefined;
  className?: string | undefined;
}

export function EmptyState({ title, desc, actionText, onAction, className }: EmptyStateProps) {
  const contents = actionText && onAction ? (
    <Button variant="secondary" type="button" onClick={onAction}>
      {actionText}
    </Button>
  ) : undefined;

  return (
    <KumoEmpty
      title={title}
      {...(desc !== undefined ? { description: desc } : {})}
      {...(contents !== undefined ? { contents } : {})}
      className={joinClassNames("dap-ui-empty-state", className)}
    />
  );
}

export interface ErrorStateProps {
  title: string;
  desc: ReactNode;
  onRetry?: MouseEventHandler<HTMLButtonElement> | undefined;
  className?: string | undefined;
  retryText?: string | undefined;
}

export function ErrorState({ title, desc, onRetry, className, retryText = "重新加载" }: ErrorStateProps) {
  return (
    <Banner
      tone="error"
      title={title}
      description={desc}
      action={onRetry ? <Button variant="secondary" type="button" onClick={onRetry}>{retryText}</Button> : undefined}
      className={joinClassNames("dap-ui-error-state", className)}
    />
  );
}
