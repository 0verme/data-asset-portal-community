import { useTranslation } from "react-i18next";

import { formatLineageSnapshotTime } from "./lineageSnapshotTime.ts";

export function LineageSnapshotTime({ value }: { value?: string | null | undefined }) {
  const { t } = useTranslation("lineage");
  const timestamp = formatLineageSnapshotTime(value);
  if (!timestamp) return <>—</>;
  return (
    <span title={value ?? undefined}>
      {timestamp.hasOffset ? timestamp.text : t("unspecifiedTimezone", { timestamp: timestamp.text })}
    </span>
  );
}
