import { ConfirmDialog } from "./ConfirmDialog.jsx";

export function DeleteConfirmDialog(props) {
  return (
    <ConfirmDialog
      title="确认删除该数据？"
      confirmText="确认删除"
      cancelText="取消"
      {...props}
    />
  );
}
