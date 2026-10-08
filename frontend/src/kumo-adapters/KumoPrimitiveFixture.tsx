import { useRef, useState } from "react";
import { Plus } from "@phosphor-icons/react";
import {
  Badge,
  Breadcrumbs,
  Button,
  Checkbox,
  Combobox,
  Field,
  Grid,
  GridItem,
  IconButton,
  Input,
  Select,
  Status,
  Surface,
  Switch,
  Tabs,
  Textarea,
} from "../ui/index.ts";
import "./kumo-adapters.css";

const schemas = [
  "dwd_order_detail",
  "schema.table_name",
  "DWS_TRADE_SALES_STAT_1D",
];

export default function KumoPrimitiveFixture() {
  const [activeTab, setActiveTab] = useState("overview");
  const [checked, setChecked] = useState(true);
  const [comboValue, setComboValue] = useState<string | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [inputValue, setInputValue] = useState("会员增长指标汇总表");
  const [navigationMessage, setNavigationMessage] = useState("尚未导航");
  const [selectValue, setSelectValue] = useState<string | null>("prod");
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <main className="kumo-adapter-fixture" data-testid="kumo-adapter-fixture">
      <header className="kumo-adapter-header">
        <div>
          <p>Issue #353 · Phase 2 primitive adapter contract</p>
          <h1>Kumo Primitive Adapter Fixture</h1>
          <p>DAP adapter API 与控件键盘行为探针；不迁移业务页面。</p>
        </div>
        <div className="kumo-adapter-actions">
          <Button data-testid="adapter-primary-button" variant="primary" size="sm">保存字段映射</Button>
          <Button data-testid="adapter-danger-button" variant="danger">移除映射</Button>
          <Button data-testid="adapter-loading-button" loading>正在保存</Button>
          <IconButton data-testid="adapter-icon-button" aria-label="新增字段" icon={<Plus aria-hidden="true" />} size="sm" />
        </div>
      </header>

      <section className="kumo-adapter-section" aria-labelledby="adapter-fields-heading">
        <h2 id="adapter-fields-heading">表单控件</h2>
        <div className="kumo-adapter-grid">
          <Field label="数据资产名称" description="DAP controlled input contract">
            <Input
              ref={inputRef}
              aria-label="数据资产名称"
              className="adapter-custom-input"
              data-testid="adapter-controlled-input"
              value={inputValue}
              onChange={(event) => setInputValue(event.currentTarget.value)}
            />
          </Field>
          <Button data-testid="adapter-focus-input" onClick={() => inputRef.current?.focus()} variant="tertiary">
            聚焦资产名称
          </Button>
          <Field label="只读 JDBC URL" description="readOnly 不等于 disabled">
            <Input aria-label="只读 JDBC URL" data-testid="adapter-readonly-input" readOnly value="jdbc:postgresql://warehouse.example.invalid/analytics" />
          </Field>
          <Field label="字段映射校验" error="目标字段名称为必填项。">
            <Input aria-label="字段映射校验" data-testid="adapter-error-input" intent="error" placeholder="目标字段名称" />
          </Field>
          <Field label="业务说明">
            <Textarea aria-label="业务说明" data-testid="adapter-textarea" defaultValue="会员增长与交易明细的关联说明。" rows={3} />
          </Field>
          <Select
            aria-label="上游系统"
            data-testid="adapter-select"
            label="上游系统"
            value={selectValue}
            onValueChange={setSelectValue}
          >
            <Select.Option value="prod">生产数仓 · PROD</Select.Option>
            <Select.Option value="stage">预发布 · STAGE</Select.Option>
            <Select.Option value="legacy">旧版 JDBC · LEGACY</Select.Option>
          </Select>
          <Combobox
            items={schemas}
            label="Schema / Table name"
            value={comboValue}
            onValueChange={setComboValue}
          >
            <Combobox.TriggerInput data-testid="adapter-combobox" placeholder="搜索 Schema / Table name" />
            <Combobox.Content>
              <Combobox.List>
                {(item: unknown) => <Combobox.Item key={String(item)} value={item}>{String(item)}</Combobox.Item>}
              </Combobox.List>
              <Combobox.Empty>没有匹配的 Schema / Table</Combobox.Empty>
            </Combobox.Content>
          </Combobox>
          <Checkbox
            checked={checked}
            data-testid="adapter-checkbox"
            label="管理员 · 只读审阅"
            onCheckedChange={setChecked}
          />
          <Switch
            checked={enabled}
            data-testid="adapter-switch"
            label="允许业务维护员编辑"
            onCheckedChange={setEnabled}
          />
        </div>
        <p data-testid="adapter-control-state">checkbox={String(checked)}; switch={String(enabled)}; select={selectValue ?? "未选择"}; combobox={comboValue ?? "未选择"}</p>
      </section>

      <section className="kumo-adapter-section" aria-labelledby="adapter-layout-heading">
        <h2 id="adapter-layout-heading">状态与布局</h2>
        <div className="kumo-adapter-actions">
          <Badge tone="success">校验通过</Badge>
          <Badge tone="danger">操作失败</Badge>
          <Status tone="warning">待复核</Status>
          <Status tone="neutral">只读</Status>
        </div>
        <Tabs
          aria-label="适配器示例标签"
          data-testid="adapter-tabs"
          value={activeTab}
          onValueChange={setActiveTab}
          tabs={[
            { value: "overview", label: "数据资产" },
            { value: "mapping", label: "字段映射" },
            { value: "logs", label: "操作日志" },
          ]}
          appearance="line"
          size="sm"
        />
        <Surface className="adapter-custom-surface" data-testid="adapter-surface">
          <h3>{activeTab === "overview" ? "资产概览" : activeTab === "mapping" ? "字段映射" : "操作日志"}</h3>
          <p>只读 · 管理员 · 中文 + English · schema.table_name</p>
        </Surface>
        <Grid columns={2} data-testid="adapter-grid" density="compact">
          <GridItem>资产名称：会员增长指标汇总表</GridItem>
          <GridItem>数据源：生产数仓 · PROD</GridItem>
        </Grid>
        <Breadcrumbs
          ariaLabel="适配器示例面包屑"
          data-testid="adapter-breadcrumbs"
          items={[
            { kind: "action", label: "首页", onNavigate: () => setNavigationMessage("已返回首页") },
            { kind: "text", label: "数据资产" },
          ]}
        />
        <p data-testid="adapter-navigation-state">{navigationMessage}</p>
      </section>
    </main>
  );
}
