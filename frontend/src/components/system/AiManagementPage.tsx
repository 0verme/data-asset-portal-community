import { useTranslation } from "react-i18next";

import { AiLlmDailyQuotaPanel } from "./AiLlmDailyQuotaPanel.tsx";
import { RagSearchConfigPanel } from "./RagSearchConfigPanel.tsx";

export function AiManagementPage({ canEdit }: { canEdit: boolean }) {
  const { t } = useTranslation("common");

  return (
    <div className="system-page ai-management-page">
      <div className="page-head">
        <div>
          <div className="page-title">{t("aiManagement.title")}</div>
          <div className="page-sub">{t("aiManagement.description")}</div>
        </div>
      </div>
      {!canEdit ? (
        <div className="rag-config-message" role="status">
          {t("aiManagement.readOnly")}
        </div>
      ) : null}
      <AiLlmDailyQuotaPanel canEdit={canEdit} />
      <RagSearchConfigPanel canEdit={canEdit} />
    </div>
  );
}
