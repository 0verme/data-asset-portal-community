import { useTranslation } from "react-i18next";

import { BrandingConfigPanel } from "./BrandingConfigPanel.tsx";

export function SiteBrandingPage({ canEdit }: { canEdit: boolean }) {
  const { t } = useTranslation("common");

  return (
    <div className="system-page site-branding-page">
      <div className="page-head">
        <div>
          <div className="page-title">{t("branding.pageTitle")}</div>
          <div className="page-sub">{t("branding.pageDescription")}</div>
        </div>
      </div>
      <BrandingConfigPanel canEdit={canEdit} />
    </div>
  );
}
