import { useTranslation } from "react-i18next";
import type { MouseEventHandler } from "react";

import { Icon } from "../ui.tsx";

export interface ActionErrorBannerProps {
  title?: string | undefined;
  message?: string | null | undefined;
  messages?: readonly (string | null | undefined)[] | undefined;
  onClose?: MouseEventHandler<HTMLButtonElement> | undefined;
}

export function ActionErrorBanner({
  title,
  message,
  messages = [],
  onClose,
}: ActionErrorBannerProps) {
  const { t } = useTranslation("common");
  const items = (messages.length ? messages : [message]).filter(
    (item): item is string => Boolean(item),
  );
  if (!items.length) return null;

  return (
    <div className="err-banner" role="alert">
      <span className="eb-ic"><Icon name="close" size={15} color="var(--danger)" /></span>
      <div style={onClose ? { flex: 1 } : undefined}>
        <b>{title ?? t("shared.failed")}</b>
        <ul>{items.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}</ul>
      </div>
      {onClose ? <button className="btn" type="button" onClick={onClose}>{t("action.close")}</button> : null}
    </div>
  );
}
