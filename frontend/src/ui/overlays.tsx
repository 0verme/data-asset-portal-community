import {
  cloneElement,
  useEffect,
  useId,
  useRef,
  useState,
  type ComponentProps,
  type ComponentPropsWithoutRef,
  type ReactElement,
  type ReactNode,
} from "react";
import { Dialog as KumoDialogPrimitive } from "@cloudflare/kumo/primitives/dialog";
import { Tooltip as KumoTooltipPrimitive } from "@cloudflare/kumo/primitives/tooltip";
import { TooltipProvider } from "@cloudflare/kumo/components/tooltip";
import { DropdownMenu as KumoDropdownMenu } from "@cloudflare/kumo/components/dropdown";
import { Popover as KumoPopover } from "@cloudflare/kumo/components/popover";
import { LayerCard as KumoLayerCard } from "@cloudflare/kumo/components/layer-card";
import type { PortalContainer } from "@cloudflare/kumo";
import { forwardRef } from "react";

import { Button } from "./Button.tsx";
import { joinClassNames } from "./classNames.ts";
import {
  OverlayContainerContext,
  useOverlayContainer,
} from "./overlayPortal.ts";
import "./overlays.css";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "area[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type=hidden])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "iframe",
  "[contenteditable=true]",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter((element) => {
    if (element.closest("[inert]") || element.getAttribute("aria-hidden") === "true") return false;
    const style = window.getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden" && element.getClientRects().length > 0;
  });
}

export type DialogRole = "dialog" | "alertdialog";

export interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  titleAdornment?: ReactNode;
  titleAction?: ReactNode;
  description?: ReactNode;
  ariaLabel?: string | undefined;
  children?: ReactNode;
  role?: DialogRole | undefined;
  closeOnOutsideClick?: boolean | undefined;
  busy?: boolean | undefined;
  className?: string | undefined;
  size?: "sm" | "md" | "lg" | "xl" | undefined;
  container?: PortalContainer | undefined;
}

export function Dialog({
  open,
  onOpenChange,
  title,
  titleAdornment,
  titleAction,
  description,
  ariaLabel,
  children,
  role = "dialog",
  closeOnOutsideClick = true,
  busy = false,
  className,
  size = "md",
  container,
}: DialogProps) {
  const portalContainer = useOverlayContainer(container);
  const popupRef = useRef<HTMLDivElement>(null);
  const openRef = useRef(open);
  openRef.current = open;

  useEffect(() => {
    const popup = popupRef.current;
    if (!open || !popup) return undefined;

    const onFocusIn = (event: FocusEvent) => {
      const target = event.target;
      if (!openRef.current || !(target instanceof Node) || popup.contains(target)) return;
      const first = getFocusableElements(popup)[0] ?? popup;
      first.focus({ preventScroll: true });
    };

    popup.ownerDocument.addEventListener("focusin", onFocusIn, true);
    return () => popup.ownerDocument.removeEventListener("focusin", onFocusIn, true);
  }, [open]);

  const handleTabKey = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!openRef.current || event.key !== "Tab") return;
    const popup = popupRef.current;
    if (!popup) return;

    const focusable = getFocusableElements(popup);
    if (!focusable.length) {
      event.preventDefault();
      popup.focus({ preventScroll: true });
      return;
    }

    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    const activeElement = popup.ownerDocument.activeElement;
    if (event.shiftKey && (activeElement === first || !popup.contains(activeElement))) {
      event.preventDefault();
      last.focus({ preventScroll: true });
    } else if (!event.shiftKey && (activeElement === last || !popup.contains(activeElement))) {
      event.preventDefault();
      first.focus({ preventScroll: true });
    }
  };

  if (!portalContainer) return null;

  return (
    <KumoDialogPrimitive.Root
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && busy) return;
        onOpenChange(nextOpen);
      }}
      disablePointerDismissal={busy || !closeOnOutsideClick}
      modal
    >
      <KumoDialogPrimitive.Portal container={portalContainer}>
        <KumoDialogPrimitive.Backdrop className="dap-ui-dialog-backdrop" />
        <KumoLayerCard
          ref={popupRef}
          render={(
            <KumoDialogPrimitive.Popup
              role={role}
              aria-modal="true"
              aria-label={title == null ? ariaLabel : undefined}
              onKeyDownCapture={handleTabKey}
            />
          )}
          className={joinClassNames("dap-ui-dialog-popup", `dap-ui-dialog-${size}`, className)}
        >
          <OverlayContainerContext.Provider value={popupRef}>
            {title != null || titleAdornment != null || titleAction != null ? (
              <div className="dap-ui-dialog-heading">
                {titleAdornment != null ? <span className="dap-ui-dialog-title-adornment" aria-hidden="true">{titleAdornment}</span> : null}
                {title != null ? <KumoDialogPrimitive.Title className="dap-ui-dialog-title">{title}</KumoDialogPrimitive.Title> : null}
                {titleAction != null ? <span className="dap-ui-dialog-title-action">{titleAction}</span> : null}
              </div>
            ) : null}
            {description != null ? (
              <KumoDialogPrimitive.Description className="dap-ui-dialog-description">
                {description}
              </KumoDialogPrimitive.Description>
            ) : null}
            {children}
          </OverlayContainerContext.Provider>
        </KumoLayerCard>
      </KumoDialogPrimitive.Portal>
    </KumoDialogPrimitive.Root>
  );
}

export interface ConfirmDialogProps {
  open: boolean;
  title?: string | undefined;
  content?: ReactNode | undefined;
  desc?: ReactNode | undefined;
  details?: readonly string[] | undefined;
  confirmKeyword?: string | undefined;
  confirmKeywordLabel?: string | undefined;
  keywordPlaceholder?: string | undefined;
  confirmText?: string | undefined;
  cancelText?: string | undefined;
  busy?: boolean | undefined;
  danger?: boolean | undefined;
  maskClosable?: boolean | undefined;
  onConfirm?: (() => void | Promise<unknown>) | undefined;
  onCancel?: (() => void) | undefined;
}

export type ConfirmOptions = Omit<ConfirmDialogProps, "open" | "busy">;

const DEFAULT_CONFIRM_TITLE = "确认删除该数据？";
const DEFAULT_CONFIRM_CONTENT = "删除后将无法恢复，请谨慎操作。";

export function ConfirmDialog({
  open,
  title = DEFAULT_CONFIRM_TITLE,
  content = DEFAULT_CONFIRM_CONTENT,
  desc,
  details = [],
  confirmKeyword = "",
  confirmKeywordLabel = "请输入确认信息",
  keywordPlaceholder = "",
  confirmText = "确认删除",
  cancelText = "取消",
  busy = false,
  danger = false,
  maskClosable = true,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const [internalBusy, setInternalBusy] = useState(false);
  const [keywordValue, setKeywordValue] = useState("");
  const keywordInputId = useId();
  const keywordHintId = useId();
  const pending = busy || internalBusy;
  const normalizedKeyword = String(confirmKeyword || "").trim();
  const keywordMatched = !normalizedKeyword || keywordValue.trim() === normalizedKeyword;
  const body = desc != null ? desc : content;

  useEffect(() => {
    if (!open) {
      setInternalBusy(false);
      setKeywordValue("");
    }
  }, [open]);

  const handleConfirm = async () => {
    if (pending || !keywordMatched) return;
    try {
      const result = onConfirm?.();
      if (result && typeof result.then === "function") {
        setInternalBusy(true);
        await result;
      }
    } catch {
      // A rejected action keeps the confirmation open for the caller to report its error.
    } finally {
      setInternalBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onCancel?.();
      }}
      title={title}
      role="alertdialog"
      closeOnOutsideClick={maskClosable}
      busy={pending}
      size="sm"
      className={danger ? "dap-ui-confirm-danger" : undefined}
    >
      {body ? <div className="dap-ui-confirm-description">{body}</div> : null}
      {details.length ? (
        <ul className="dap-ui-confirm-details">
          {details.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}
        </ul>
      ) : null}
      {normalizedKeyword ? (
        <div className="dap-ui-confirm-keyword">
          <label htmlFor={keywordInputId}>{confirmKeywordLabel}</label>
          <input
            id={keywordInputId}
            className="dap-ui-confirm-keyword-input"
            type="text"
            value={keywordValue}
            placeholder={keywordPlaceholder || normalizedKeyword}
            aria-describedby={keywordHintId}
            onChange={(event) => setKeywordValue(event.target.value)}
            disabled={pending}
          />
          <p id={keywordHintId}>请输入 {normalizedKeyword} 以确认删除。</p>
        </div>
      ) : null}
      <div className="dap-ui-dialog-actions">
        <Button variant="secondary" type="button" onClick={onCancel} disabled={pending}>
          {cancelText}
        </Button>
        <Button
          variant={danger ? "danger" : "primary"}
          type="button"
          onClick={handleConfirm}
          disabled={pending || !keywordMatched}
        >
          {pending ? "处理中..." : confirmText}
        </Button>
      </div>
    </Dialog>
  );
}

export function ConfirmDialogHost() {
  const [state, setState] = useState<{ open: boolean; options: ConfirmOptions; busy: boolean }>({
    open: false,
    options: {},
    busy: false,
  });
  const resolverRef = useRef<((result: boolean) => void) | null>(null);

  useEffect(() => {
    openConfirm = (options: ConfirmOptions) => {
      if (resolverRef.current) return Promise.resolve(false);
      return new Promise<boolean>((resolve) => {
        resolverRef.current = resolve;
        setState({ open: true, options, busy: false });
      });
    };
    return () => {
      openConfirm = null;
      resolverRef.current?.(false);
      resolverRef.current = null;
    };
  }, []);

  const settle = (result: boolean) => {
    const resolve = resolverRef.current;
    resolverRef.current = null;
    setState((previous) => ({ ...previous, open: false, busy: false }));
    resolve?.(result);
  };

  const handleConfirm = async () => {
    const { onConfirm } = state.options;
    if (onConfirm) {
      setState((previous) => ({ ...previous, busy: true }));
      try {
        await onConfirm();
      } catch {
        setState((previous) => ({ ...previous, busy: false }));
        return;
      }
    }
    settle(true);
  };

  return (
    <ConfirmDialog
      open={state.open}
      title={state.options.title}
      content={state.options.content}
      desc={state.options.desc}
      details={state.options.details}
      confirmKeyword={state.options.confirmKeyword}
      confirmKeywordLabel={state.options.confirmKeywordLabel}
      keywordPlaceholder={state.options.keywordPlaceholder}
      confirmText={state.options.confirmText}
      cancelText={state.options.cancelText}
      maskClosable={state.options.maskClosable !== false}
      busy={state.busy}
      danger={state.options.danger === true}
      onConfirm={handleConfirm}
      onCancel={() => !state.busy && settle(false)}
    />
  );
}

let openConfirm: ((options: ConfirmOptions) => Promise<boolean>) | null = null;

export function confirmAction(options: ConfirmOptions = {}): Promise<boolean> {
  return openConfirm ? openConfirm(options) : Promise.resolve(false);
}

export function confirmDelete(options: ConfirmOptions = {}): Promise<boolean> {
  return confirmAction({
    title: DEFAULT_CONFIRM_TITLE,
    confirmText: "确认删除",
    cancelText: "取消",
    danger: true,
    ...options,
  });
}

export interface ConfirmDeleteActionOptions extends ConfirmOptions {
  name?: string | undefined;
  typeLabel?: string | undefined;
  impact?: string | undefined;
  consequences?: readonly string[] | undefined;
}

export function confirmDeleteAction({
  name,
  typeLabel = "该数据",
  impact = "",
  consequences = [],
  confirmKeyword = "",
  confirmKeywordLabel,
  keywordPlaceholder,
  ...options
}: ConfirmDeleteActionOptions = {}): Promise<boolean> {
  const content = impact || `${typeLabel}${name ? `“${name}”` : ""}删除后将无法恢复，请谨慎操作。`;
  return confirmDelete({
    content,
    details: consequences,
    confirmKeyword,
    confirmKeywordLabel,
    keywordPlaceholder,
    ...options,
  });
}

export interface TooltipProps {
  trigger: ReactElement;
  content: ReactNode;
  side?: ComponentProps<typeof KumoTooltipPrimitive.Positioner>["side"];
  align?: ComponentProps<typeof KumoTooltipPrimitive.Positioner>["align"];
  delay?: number | undefined;
  closeDelay?: number | undefined;
  className?: string | undefined;
  container?: PortalContainer | undefined;
}

export function Tooltip({
  trigger,
  content,
  side = "top",
  align = "center",
  delay = 500,
  closeDelay = 0,
  className,
  container,
}: TooltipProps) {
  const portalContainer = useOverlayContainer(container);
  const tooltipId = useId();
  const [open, setOpen] = useState(false);
  const existingDescription = (trigger.props as { "aria-describedby"?: string })["aria-describedby"];
  const describedBy = open
    ? Array.from(new Set([...(existingDescription ?? "").split(/\s+/).filter(Boolean), tooltipId])).join(" ")
    : existingDescription;
  const describedTrigger = describedBy
    ? cloneElement(trigger as ReactElement<{ "aria-describedby"?: string }>, { "aria-describedby": describedBy })
    : trigger;

  if (!portalContainer) return describedTrigger;

  return (
    <KumoTooltipPrimitive.Root open={open} onOpenChange={setOpen}>
      <KumoTooltipPrimitive.Trigger delay={delay} closeDelay={closeDelay} render={describedTrigger} />
      <KumoTooltipPrimitive.Portal container={portalContainer}>
        <KumoTooltipPrimitive.Positioner side={side} align={align} sideOffset={8}>
          <KumoTooltipPrimitive.Popup
            id={tooltipId}
            role="tooltip"
            className={joinClassNames("dap-ui-tooltip-popup", className)}
          >
            {content}
          </KumoTooltipPrimitive.Popup>
        </KumoTooltipPrimitive.Positioner>
      </KumoTooltipPrimitive.Portal>
    </KumoTooltipPrimitive.Root>
  );
}

export { TooltipProvider };

const DapPopoverContent = (props: ComponentProps<typeof KumoPopover.Content>) => {
  const container = useOverlayContainer(props.container);
  return <KumoPopover.Content {...props} container={container} className={joinClassNames("dap-ui-popover-content", props.className)} />;
};

function DapPopoverRoot(props: ComponentProps<typeof KumoPopover>) {
  return <KumoPopover {...props} />;
}

export const Popover = Object.assign(DapPopoverRoot, { ...KumoPopover, Content: DapPopoverContent });

type DropdownContentProps = ComponentPropsWithoutRef<typeof KumoDropdownMenu.Content>;

const DapDropdownContent = forwardRef<HTMLDivElement, DropdownContentProps>(function DapDropdownContent(
  { className, container, ...props },
  ref,
) {
  const portalContainer = useOverlayContainer(container);
  return (
    <KumoDropdownMenu.Content
      {...props}
      ref={ref}
      container={portalContainer}
      className={className}
      data-dap-ui-layer="dropdown"
    />
  );
});

function DapDropdownRoot(props: ComponentProps<typeof KumoDropdownMenu>) {
  return <KumoDropdownMenu {...props} />;
}

export const DropdownMenu = Object.assign(DapDropdownRoot, { ...KumoDropdownMenu, Content: DapDropdownContent });
