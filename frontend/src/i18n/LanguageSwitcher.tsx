import { type ReactElement } from "react";
import { useTranslation } from "react-i18next";

import { changeLanguage, normalizeLanguage } from "./index.ts";
import { Button } from "../ui/index.ts";

export function LanguageSwitcher({ className = "" }: { className?: string }): ReactElement {
  const { t, i18n } = useTranslation("common");
  const currentLanguage = normalizeLanguage(i18n.resolvedLanguage || i18n.language);
  const targetLanguage = currentLanguage === "zh-CN" ? "en-US" : "zh-CN";
  const label = currentLanguage === "zh-CN"
    ? t("language.switchToEnglish")
    : t("language.switchToChinese");
  const targetLabel = currentLanguage === "zh-CN"
    ? t("language.targetEnglish")
    : t("language.targetChinese");

  return (
    <Button
      type="button"
      variant="tertiary"
      size="sm"
      className={`language-switcher${className ? ` ${className}` : ""}`}
      aria-label={label}
      lang={targetLanguage}
      data-locale-target={targetLanguage}
      onClick={() => void changeLanguage(targetLanguage)}
    >
      {targetLabel}
    </Button>
  );
}
