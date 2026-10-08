import { useState } from "react";
import {
  Banner,
  Button,
  ConfirmDialog,
  ConfirmDialogHost,
  Dialog,
  DropdownMenu,
  EmptyState,
  ErrorState,
  FormModal,
  LoadingState,
  Popover,
  Surface,
  ToastHost,
  Tooltip,
  confirmAction,
  toast,
} from "../ui/index.ts";
import "./kumo-overlays.css";

export default function KumoOverlayFixture() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [formBusy, setFormBusy] = useState(false);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [confirmResult, setConfirmResult] = useState("尚未确认");
  const [serviceConfirmResult, setServiceConfirmResult] = useState("pending");

  const submitForm = () => {
    setFormBusy(true);
    window.setTimeout(() => {
      setFormBusy(false);
      setFormOpen(false);
    }, 900);
  };

  const confirmDelete = () => {
    setConfirmBusy(true);
    return new Promise<void>((resolve) => {
      window.setTimeout(() => {
        setConfirmBusy(false);
        setConfirmOpen(false);
        setConfirmResult("确认已完成");
        resolve();
      }, 900);
    });
  };

  return (
    <ToastHost>
      <main className="kumo-overlays-fixture" data-testid="kumo-overlays-fixture">
        <header className="kumo-overlays-header">
          <p>Issue #355 · Phase 2 shared overlay/feedback contract</p>
          <h1>Kumo Overlay Adapter Fixture</h1>
          <p>仅验证 DAP adapter 与浏览器行为；不迁移业务页面。</p>
        </header>

        <section className="kumo-overlays-section" aria-labelledby="overlay-actions-heading">
          <h2 id="overlay-actions-heading">共享交互</h2>
          <div className="kumo-overlays-actions">
            <Button data-testid="open-dialog" onClick={() => setDialogOpen(true)}>打开 DAP Dialog</Button>
            <Button data-testid="open-confirm" variant="danger" onClick={() => setConfirmOpen(true)}>打开关键字确认</Button>
            <Button data-testid="open-form-modal" variant="secondary" onClick={() => setFormOpen(true)}>打开 FormModal</Button>
            <Button data-testid="show-toast" variant="tertiary" onClick={() => toast.success("字段映射保存成功", { duration: 0 })}>显示 Toast</Button>
            <Button data-testid="show-toast-timeout" variant="tertiary" onClick={() => toast.info("短时通知已到达", { duration: 250 })}>显示短时 Toast</Button>
            <Button
              data-testid="show-toast-queue"
              variant="tertiary"
              onClick={() => {
                toast.success("队列消息一", { duration: 0 });
                toast.error("队列消息二", { duration: 0 });
              }}
            >
              显示 Toast 队列
            </Button>
            <Button
              data-testid="open-service-confirm"
              variant="secondary"
              onClick={() => {
                void confirmAction({
                  title: "Promise-based confirmation",
                  content: "服务确认结果应返回 Promise<boolean>。",
                  confirmText: "执行确认",
                  onConfirm: () => new Promise<void>((resolve) => window.setTimeout(resolve, 300)),
                }).then((result) => setServiceConfirmResult(String(result)));
              }}
            >
              打开 Promise 确认
            </Button>
          </div>
          <p data-testid="confirm-result">{confirmResult}</p>
          <p data-testid="service-confirm-result">{serviceConfirmResult}</p>
        </section>

        <section className="kumo-overlays-section" aria-labelledby="floating-overlays-heading">
          <h2 id="floating-overlays-heading">Tooltip / Popover / Dropdown</h2>
          <div className="kumo-overlays-actions">
            <Tooltip trigger={<Button data-testid="tooltip-trigger" variant="secondary">提示</Button>} content="Tooltip 可访问描述" delay={0} />
            <Popover>
              <Popover.Trigger render={<Button data-testid="popover-trigger" variant="secondary" />}>打开 Popover</Popover.Trigger>
              <Popover.Content data-testid="popover-content" side="bottom" align="start">
                <Popover.Title>资产字段说明</Popover.Title>
                <Popover.Description>schema.table_name · 中文说明</Popover.Description>
              </Popover.Content>
            </Popover>
            <DropdownMenu>
              <DropdownMenu.Trigger render={<Button data-testid="dropdown-trigger" variant="secondary" />}>打开菜单</DropdownMenu.Trigger>
              <DropdownMenu.Content align="end">
                <DropdownMenu.Item data-testid="dropdown-item">查看字段映射</DropdownMenu.Item>
                <DropdownMenu.Item variant="danger">删除（危险操作）</DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu>
          </div>
        </section>

        <section className="kumo-overlays-section" aria-labelledby="states-heading">
          <h2 id="states-heading">状态组件</h2>
          <div className="kumo-overlays-state-grid">
            <Surface><LoadingState title="正在加载资产" desc="请稍候。" /></Surface>
            <Surface><EmptyState title="没有匹配的数据资产" desc="调整筛选条件后重试。" actionText="清除筛选" onAction={() => toast.info("筛选条件已清除")} /></Surface>
            <Surface><ErrorState title="读取数据失败" desc="网络连接中断。" onRetry={() => toast.warning("正在重试")} /></Surface>
          </div>
          <Banner title="同步任务待复核" description="上游连接信息需要管理员确认。" tone="warning" />
        </section>

        <Dialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          title="DAP Dialog"
          description="WebKit Tab 边界、Portal 与 aria-hidden 兼容性探针。"
          closeOnOutsideClick={false}
          size="md"
        >
          <div className="kumo-overlays-dialog-body">
            <p>焦点应该留在 Dialog 中；此 Portal 与其他 DAP adapter 共用 overlay root。</p>
            <Tooltip trigger={<Button data-testid="dialog-tooltip-trigger" variant="tertiary">Dialog 内 Tooltip</Button>} content="Tooltip 在 Dialog 的 portal 内" delay={0} />
            <Button data-testid="dialog-toast" variant="secondary" onClick={() => toast.info("Dialog 内的通知", { duration: 0 })}>Dialog 内触发 Toast</Button>
            <Button data-testid="dialog-first" variant="secondary">第一个焦点项</Button>
            <Button data-testid="dialog-last" variant="secondary">最后一个焦点项</Button>
            <Button data-testid="close-dialog" onClick={() => setDialogOpen(false)}>关闭 Dialog</Button>
          </div>
        </Dialog>

        <ConfirmDialog
          open={confirmOpen}
          title="确认删除字段映射？"
          content="此操作无法撤销。"
          details={["资产：会员增长指标汇总表", "字段：schema.table_name"]}
          confirmKeyword="schema.table_name"
          confirmKeywordLabel="输入字段名以继续"
          confirmText="确认删除"
          busy={confirmBusy}
          onConfirm={confirmDelete}
          onCancel={() => setConfirmOpen(false)}
        />

        <ConfirmDialogHost />

        <FormModal
          open={formOpen}
          title="编辑资产字段"
          subtitle="schema.table_name · 只读预览"
          icon={<span>✎</span>}
          busy={formBusy}
          onClose={() => setFormOpen(false)}
          onSubmit={submitForm}
        >
          <label className="kumo-overlays-form-field">
            字段名称
            <input aria-label="字段名称" defaultValue="table_name" />
          </label>
        </FormModal>
      </main>
    </ToastHost>
  );
}
