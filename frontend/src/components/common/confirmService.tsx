import React from "react";

import { ConfirmDialog, type ConfirmOptions } from "./ConfirmDialog.tsx";

let openConfirm: ((options: ConfirmOptions) => Promise<boolean>) | null = null;

export function confirmAction(options: ConfirmOptions = {}): Promise<boolean> {
  if (!openConfirm) {
    return Promise.resolve(false);
  }
  return openConfirm(options);
}

export function confirmDelete(options: ConfirmOptions = {}): Promise<boolean> {
  return confirmAction({
    title: "确认删除该数据？",
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

interface ConfirmDialogState {
  open: boolean;
  options: ConfirmOptions;
  busy: boolean;
}

export function ConfirmDialogHost() {
  const [state, setState] = React.useState<ConfirmDialogState>({ open: false, options: {}, busy: false });
  const resolverRef = React.useRef<((result: boolean) => void) | null>(null);

  React.useEffect(() => {
    openConfirm = (options: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        resolverRef.current = resolve;
        setState({ open: true, options, busy: false });
      });
    return () => {
      openConfirm = null;
    };
  }, []);

  const settle = (result: boolean) => {
    const resolve = resolverRef.current;
    resolverRef.current = null;
    setState((prev) => ({ ...prev, open: false, busy: false }));
    resolve?.(result);
  };

  const handleConfirm = async () => {
    const { onConfirm } = state.options;
    if (onConfirm) {
      setState((prev) => ({ ...prev, busy: true }));
      try {
        await onConfirm();
      } catch {
        setState((prev) => ({ ...prev, busy: false }));
        return;
      }
    }
    settle(true);
  };

  const { options } = state;
  return (
    <ConfirmDialog
      open={state.open}
      title={options.title}
      content={options.content}
      desc={options.desc}
      details={options.details}
      confirmKeyword={options.confirmKeyword}
      confirmKeywordLabel={options.confirmKeywordLabel}
      keywordPlaceholder={options.keywordPlaceholder}
      confirmText={options.confirmText}
      cancelText={options.cancelText}
      maskClosable={options.maskClosable !== false}
      busy={state.busy}
      danger={options.danger === true}
      onConfirm={handleConfirm}
      onCancel={() => !state.busy && settle(false)}
    />
  );
}
