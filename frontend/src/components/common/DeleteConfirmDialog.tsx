import { ConfirmDialog, type ConfirmDialogProps } from "./ConfirmDialog.tsx";

export type DeleteConfirmDialogProps = Omit<ConfirmDialogProps, "title" | "confirmText" | "cancelText">;

export function DeleteConfirmDialog(props: DeleteConfirmDialogProps) {
  return (
    <ConfirmDialog
      title="确认删除该数据？"
      confirmText="确认删除"
      cancelText="取消"
      {...props}
    />
  );
}
