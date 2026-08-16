import React from "react";
import { ConfirmDialog } from "./ConfirmDialog.jsx";

let openConfirm = null;

export function confirmAction(options = {}) {
  if (!openConfirm) {
    return Promise.resolve(false);
  }
  return openConfirm(options);
}

export function confirmDelete(options = {}) {
  return confirmAction({
    title: "确认删除该数据？",
    confirmText: "确认删除",
    cancelText: "取消",
    danger: true,
    ...options,
  });
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
} = {}) {
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

export function ConfirmDialogHost() {
  const [state, setState] = React.useState({ open: false, options: {}, busy: false });
  const resolverRef = React.useRef(null);

  React.useEffect(() => {
    openConfirm = (options) =>
      new Promise((resolve) => {
        resolverRef.current = resolve;
        setState({ open: true, options: options || {}, busy: false });
      });
    return () => {
      openConfirm = null;
    };
  }, []);

  const settle = (result) => {
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
