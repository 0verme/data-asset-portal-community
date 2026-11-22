import { ConfirmDialog, type ConfirmDialogProps } from "./ConfirmDialog.tsx";

export type DeleteConfirmDialogProps = Omit<ConfirmDialogProps, "title" | "confirmText" | "cancelText">;

export function DeleteConfirmDialog(props: DeleteConfirmDialogProps) {
  return <ConfirmDialog {...props} />;
}
