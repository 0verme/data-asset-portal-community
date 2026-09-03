import type { MouseEventHandler } from "react";

import { Icon } from "../ui.tsx";

export interface ActionErrorBannerProps {
  title?: string | undefined;
  message?: string | null | undefined;
  messages?: readonly (string | null | undefined)[] | undefined;
  onClose?: MouseEventHandler<HTMLButtonElement> | undefined;
}

export function ActionErrorBanner({
  title = "操作失败",
  message,
  messages = [],
  onClose,
}: ActionErrorBannerProps) {
  const items = (messages.length ? messages : [message]).filter(
    (item): item is string => Boolean(item),
  );
  if (!items.length) return null;

  return (
    <div className="err-banner" role="alert">
      <span className="eb-ic"><Icon name="close" size={15} color="var(--danger)" /></span>
      <div style={onClose ? { flex: 1 } : undefined}>
        <b>{title}：</b>
        <ul>{items.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}</ul>
      </div>
      {onClose ? <button className="btn" type="button" onClick={onClose}>关闭</button> : null}
    </div>
  );
}
