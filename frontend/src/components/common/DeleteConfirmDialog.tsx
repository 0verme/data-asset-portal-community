import { useTranslation } from "react-i18next";
import { ConfirmDialog, type ConfirmDialogProps } from "./ConfirmDialog.tsx";

export type DeleteConfirmDialogProps = Omit<ConfirmDialogProps, "title" | "confirmText" | "cancelText">;

export function DeleteConfirmDialog(props: DeleteConfirmDialogProps) {
  const { t } = useTranslation("common");
  return (
    <ConfirmDialog
      title={t("confirmation.defaultTitle")}
      confirmText={t("confirmation.confirm")}
      cancelText={t("action.cancel")}
      {...props}
    />
  );
}
