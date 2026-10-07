import { useEffect, useState } from "react";
import {
  ArrowCounterClockwise,
  Database,
  WarningCircle,
} from "@phosphor-icons/react";
import { Badge } from "@cloudflare/kumo/components/badge";
import { Button } from "@cloudflare/kumo/components/button";
import { Checkbox } from "@cloudflare/kumo/components/checkbox";
import { Combobox } from "@cloudflare/kumo/components/combobox";
import { Dialog } from "@cloudflare/kumo/components/dialog";
import { DropdownMenu } from "@cloudflare/kumo/components/dropdown";
import { Empty } from "@cloudflare/kumo/components/empty";
import { Field } from "@cloudflare/kumo/components/field";
import { Input, InputGroup } from "@cloudflare/kumo/components/input";
import { Loader } from "@cloudflare/kumo/components/loader";
import { Pagination } from "@cloudflare/kumo/components/pagination";
import { Popover } from "@cloudflare/kumo/components/popover";
import { Select } from "@cloudflare/kumo/components/select";
import { Surface } from "@cloudflare/kumo/components/surface";
import { Switch } from "@cloudflare/kumo/components/switch";
import { Table } from "@cloudflare/kumo/components/table";
import { Tabs } from "@cloudflare/kumo/components/tabs";
import { Toasty, useKumoToastManager } from "@cloudflare/kumo/components/toast";
import { Tooltip } from "@cloudflare/kumo/components/tooltip";
import { ConfirmDialog, ToastHost, toast } from "../components/common/index.ts";
import "./kumo-spike.css";

type Theme = "light" | "dark";

const THEME_KEY = "dap-theme";
const schemas = [
  "dwd_xxx",
  "schema.table_name",
  "DWS_TRADE_SALES_STAT_1D",
  "retail_order_detail_long_schema_name",
];

function initialTheme(): Theme {
  return window.localStorage.getItem(THEME_KEY) === "dark" ? "dark" : "light";
}

function ToastActions() {
  const kumoToasts = useKumoToastManager();
  return (
    <div className="kumo-spike-actions">
      <Button
        data-testid="kumo-toast-success"
        onClick={() => kumoToasts.add({ title: "保存成功", description: "字段映射已更新 · schema.table_name", timeout: 5000, variant: "success" })}
      >
        Kumo success Toast
      </Button>
      <Button
        variant="secondary"
        data-testid="kumo-toast-warning"
        onClick={() => kumoToasts.add({ title: "需要复核", description: "上游系统 JDBC URL 尚未确认。", timeout: 5000, variant: "warning" })}
      >
        Kumo warning Toast
      </Button>
    </div>
  );
}

function FixtureBody({ theme, onThemeChange }: { theme: Theme; onThemeChange: () => void }) {
  const [activeTab, setActiveTab] = useState("overview");
  const [checked, setChecked] = useState(true);
  const [enabled, setEnabled] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [legacyDialogOpen, setLegacyDialogOpen] = useState(false);
  const [page, setPage] = useState(1);
  const kumoToasts = useKumoToastManager();

  return (
    <div className="kumo-spike" data-testid="kumo-spike">
      <header className="kumo-spike-header">
        <div>
          <div className="kumo-spike-eyebrow">Issue #341 · Phase 1 Compatibility Spike</div>
          <h1>Kumo × 数据资产审批</h1>
          <p>在 DAP React 19、现有 CSS、主题、Portal 与响应式外壳中的隔离兼容性探针。</p>
        </div>
        <Button variant="secondary" onClick={onThemeChange} data-testid="theme-toggle">
          DAP {theme === "light" ? "浅色" : "深色"} · 切换主题
        </Button>
      </header>

      <main className="kumo-spike-main">
        <section className="kumo-spike-section" aria-labelledby="kumo-fields-title">
          <div className="kumo-spike-section-heading">
            <div>
              <h2 id="kumo-fields-title">数据资产字段维护</h2>
              <p>真实混合字段：中文业务名、英文约定、数字、Schema / Table 和长连接标识。</p>
            </div>
            <Badge variant="success" appearance="dot">数据已校验</Badge>
          </div>
          <div className="kumo-spike-grid kumo-spike-grid-fields">
            <Field label="数据资产" description="中文 + English + number：会员增长 2026 KPI" required>
              <Input aria-label="数据资产名称" defaultValue="会员增长指标汇总表" />
            </Field>
            <Field label="Schema / Table name" description="长字段：retail_order_detail_long_schema_name">
              <Input aria-label="Schema Table name" defaultValue="dwd_retail_order_detail_di" />
            </Field>
            <Field label="只读 JDBC URL" description="readonly · URL / SQL 不应被全局 reset 改写">
              <Input aria-label="只读 JDBC URL" readOnly value="jdbc:postgresql://warehouse.example.invalid:5432/analytics?schema=dwd" />
            </Field>
            <Field label="字段映射（校验错误）" error={{ message: "字段映射缺少目标列，请检查 schema.table_name。", match: "valueMissing" }}>
              <Input aria-label="字段映射校验错误" variant="error" placeholder="目标字段名称" />
            </Field>
            <InputGroup label="数据连接标识" description="InputGroup / Field · 禁用态" size="sm" disabled>
              <InputGroup.Addon>JDBC</InputGroup.Addon>
              <InputGroup.Input aria-label="禁用的数据连接标识" value="warehouse_readonly" readOnly />
              <InputGroup.Suffix>URL</InputGroup.Suffix>
            </InputGroup>
            <Field label="上游系统" description="Field 包裹 Select，选项使用真实中文和代码值">
              <Select aria-label="上游系统" defaultValue="prod">
                <Select.Option value="prod">生产数仓 · PROD</Select.Option>
                <Select.Option value="stage">预发布 · STAGE</Select.Option>
                <Select.Option value="legacy">旧版 JDBC · LEGACY</Select.Option>
              </Select>
            </Field>
            <div className="kumo-spike-field">
              <label className="kumo-spike-label" htmlFor="kumo-combobox">指标维护员 · Combobox</label>
              <Combobox items={schemas}>
                <Combobox.TriggerInput id="kumo-combobox" placeholder="搜索 Schema / Table name" aria-label="指标维护员 Combobox" />
                <Combobox.Content>
                  <Combobox.List>
                    {(item) => <Combobox.Item key={String(item)} value={item}>{String(item)}</Combobox.Item>}
                  </Combobox.List>
                  <Combobox.Empty>没有匹配的 Schema / Table</Combobox.Empty>
                </Combobox.Content>
              </Combobox>
            </div>
            <div className="kumo-spike-field kumo-spike-choice-field">
              <Checkbox label="管理员 · 只读审阅" checked={checked} onCheckedChange={(value) => setChecked(Boolean(value))} />
              <Checkbox label="已停用映射" disabled />
              <Switch label="允许业务维护员编辑" checked={enabled} onCheckedChange={setEnabled} />
              <Switch label="只读策略（disabled）" disabled checked />
            </div>
          </div>
        </section>

        <section className="kumo-spike-section" aria-labelledby="kumo-status-title">
          <div className="kumo-spike-section-heading">
            <div>
              <h2 id="kumo-status-title">状态、密度与交互</h2>
              <p>Button / Badge / Tabs / Loader / Empty / Surface；不迁移业务页面。</p>
            </div>
            <Button size="sm" variant="outline" icon={ArrowCounterClockwise} onClick={() => setPage(1)}>
              Reset probe
            </Button>
          </div>
          <div className="kumo-spike-row kumo-spike-status-row">
            <Button variant="primary">保存字段映射</Button>
            <Button variant="secondary">返回预览</Button>
            <Button variant="secondary-destructive">移除映射</Button>
            <Button variant="primary" loading>正在保存</Button>
            <Button variant="secondary" disabled>无权限（disabled）</Button>
            <Badge variant="success">success · 已完成</Badge>
            <Badge variant="warning">warning · 待复核</Badge>
            <Badge variant="error">danger/error · 失败</Badge>
          </div>
          <Tabs
            aria-label="资产详情标签"
            value={activeTab}
            onValueChange={setActiveTab}
            tabs={[
              { value: "overview", label: "数据资产" },
              { value: "mapping", label: "字段映射" },
              { value: "logs", label: "操作日志" },
            ]}
            size="sm"
            variant="underline"
          />
          <Surface className="kumo-spike-surface">
            <div className="kumo-spike-surface-title"><Database size={18} aria-hidden="true" />{activeTab === "overview" ? "Table density probe" : `${activeTab} · DAP semantic surface`}</div>
            <div className="kumo-spike-surface-copy">只读 · 管理员 · 业务维护员 · 中文 + English + 12345</div>
            <div className="kumo-spike-inline-loader"><Loader aria-label="正在加载字段" size="sm" /> 正在加载字段 Schema</div>
          </Surface>
          <div className="kumo-spike-table-frame" data-testid="kumo-table-scroll">
            <Table aria-label="字段映射兼容性表">
              <Table.Header variant="compact">
                <Table.Row>
                  <Table.Head>字段映射</Table.Head>
                  <Table.Head>Schema / Table</Table.Head>
                  <Table.Head>类型 / 状态</Table.Head>
                  <Table.Head>负责人</Table.Head>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                <Table.Row><Table.Cell>上游订单 ID</Table.Cell><Table.Cell><code>dwd_trade_order_detail_di.order_id</code></Table.Cell><Table.Cell><Badge variant="success">已映射</Badge></Table.Cell><Table.Cell>管理员</Table.Cell></Table.Row>
                <Table.Row><Table.Cell>字段映射更新时间戳（长字段）</Table.Cell><Table.Cell><code>schema.table_name.updated_at</code></Table.Cell><Table.Cell><Badge variant="warning">待复核</Badge></Table.Cell><Table.Cell>业务维护员</Table.Cell></Table.Row>
                <Table.Row><Table.Cell>JDBC 源字段</Table.Cell><Table.Cell><code>jdbc_source.dwd_xxx.partition_date</code></Table.Cell><Table.Cell><Badge variant="error">danger / error</Badge></Table.Cell><Table.Cell>只读</Table.Cell></Table.Row>
                <Table.Row><Table.Cell>销售金额（含税）</Table.Cell><Table.Cell><code>DWS_TRADE_SALES_STAT_1D.sales_amount</code></Table.Cell><Table.Cell><Badge variant="secondary">仅预览</Badge></Table.Cell><Table.Cell>指标维护员</Table.Cell></Table.Row>
              </Table.Body>
            </Table>
          </div>
          <Pagination
            page={page}
            setPage={setPage}
            perPage={10}
            totalCount={37}
            labels={{ navigation: "分页", firstPage: "第一页", previousPage: "上一页", nextPage: "下一页", lastPage: "最后一页", pageNumber: "页码" }}
          >
            <Pagination.Info>{({ page: current, pageShowingRange }) => `第 ${current} 页 · ${pageShowingRange}`}</Pagination.Info>
            <Pagination.Controls />
          </Pagination>
          <Empty
            size="sm"
            icon={<WarningCircle size={32} aria-hidden="true" />}
            title="没有待处理字段"
            description="当前 Schema.table_name 无待维护映射。"
          />
        </section>

        <section className="kumo-spike-section kumo-spike-overlay-section" aria-labelledby="kumo-overlays-title">
          <div className="kumo-spike-section-heading">
            <div>
              <h2 id="kumo-overlays-title">Portal / overlay probe</h2>
              <p>Dialog、Popover、DropdownMenu、Tooltip、Toasty 与 DAP legacy modal/toast 同页共存。</p>
            </div>
            <Badge variant="info">default portal → document.body</Badge>
          </div>
          <div className="kumo-spike-row kumo-spike-overlay-actions">
            <Dialog.Root open={dialogOpen} onOpenChange={setDialogOpen}>
              <Dialog.Trigger render={<Button data-testid="open-kumo-dialog" variant="primary" />}>打开 Kumo Dialog</Dialog.Trigger>
              <Dialog size="lg" className="kumo-spike-dialog">
                <Dialog.Title>字段映射确认</Dialog.Title>
                <Dialog.Description>检查 Dialog Portal、焦点管理、Esc 关闭与 DAP layer。</Dialog.Description>
                <Field label="对话框内字段" description="initial focus / Tab trap smoke">
                  <Input aria-label="对话框内字段" defaultValue="schema.table_name" />
                </Field>
                <div className="kumo-spike-row">
                  <Button variant="secondary" onClick={() => kumoToasts.add({ title: "对话框内 Toast", description: "Toast Portal 与 Dialog stacking smoke。", timeout: 5000, variant: "success" })}>Dialog 内触发 Toast</Button>
                  <Button variant="outline" data-testid="open-dap-dialog-from-kumo" onClick={() => setLegacyDialogOpen(true)}>从 Kumo Dialog 打开 DAP modal</Button>
                  <Dialog.Close render={<Button variant="primary" data-testid="close-kumo-dialog" />}>确认并关闭</Dialog.Close>
                </div>
              </Dialog>
            </Dialog.Root>
            <Popover>
              <Popover.Trigger render={<Button variant="secondary" data-testid="open-kumo-popover" />}>打开边缘 Popover</Popover.Trigger>
              <Popover.Content align="end" side="bottom" className="kumo-spike-popover">
                <Popover.Title>字段详情</Popover.Title>
                <Popover.Description>schema.table_name · JDBC · 中文字段映射。</Popover.Description>
              </Popover.Content>
            </Popover>
            <DropdownMenu>
              <DropdownMenu.Trigger render={<Button variant="outline" data-testid="open-kumo-menu" />}>打开 DropdownMenu</DropdownMenu.Trigger>
              <DropdownMenu.Content align="end">
                <DropdownMenu.Group>
                  <DropdownMenu.Label>数据资产操作</DropdownMenu.Label>
                  <DropdownMenu.Item onClick={() => setActiveTab("mapping")}>查看字段映射</DropdownMenu.Item>
                  <DropdownMenu.Item onClick={() => kumoToasts.add({ title: "成功", description: "Dropdown action selected", timeout: 4000, variant: "success" })}>触发成功提示</DropdownMenu.Item>
                </DropdownMenu.Group>
                <DropdownMenu.Separator />
                <DropdownMenu.Item variant="danger">删除（danger）</DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu>
            <Tooltip content="Tooltip 可通过键盘 Tab 聚焦触发器访问" delay={0} render={<Button variant="secondary" aria-label="Tooltip 键盘触发器">Tooltip 键盘触发</Button>} />
            <Button variant="secondary" data-testid="open-dap-dialog" onClick={() => setLegacyDialogOpen(true)}>打开 DAP legacy modal</Button>
            <Button variant="outline" data-testid="open-dap-toast" onClick={() => toast.success("DAP legacy toast：保存成功")}>触发 DAP legacy toast</Button>
          </div>
          <ToastActions />
          <div className="kumo-spike-fixed-probe" data-testid="fixed-ui-probe">DAP fixed / mobile overlay collision probe</div>
          <ConfirmDialog
            open={legacyDialogOpen}
            title="DAP legacy confirmation"
            content="这是现有 DAP ConfirmDialog，仅作为共存探针。"
            confirmText="确认"
            onConfirm={() => { setLegacyDialogOpen(false); toast.success("Legacy dialog confirmed"); }}
            onCancel={() => setLegacyDialogOpen(false)}
          />
          <ToastHost />
        </section>
      </main>
      <footer className="kumo-spike-footer">Spike only · no business routes, backend data, or navigation entry.</footer>
    </div>
  );
}

export default function KumoCompatibilityFixture() {
  const [theme, setTheme] = useState<Theme>(initialTheme);

  useEffect(() => {
    document.documentElement.dataset["theme"] = theme;
    document.documentElement.dataset["mode"] = theme === "dark" ? "dark" : "light";
    window.localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  const toggleTheme = () => {
    const next = theme === "light" ? "dark" : "light";
    document.documentElement.dataset["theme"] = next;
    document.documentElement.dataset["mode"] = next === "dark" ? "dark" : "light";
    window.localStorage.setItem(THEME_KEY, next);
    setTheme(next);
  };

  return (
    <Toasty>
      <FixtureBody theme={theme} onThemeChange={toggleTheme} />
    </Toasty>
  );
}
