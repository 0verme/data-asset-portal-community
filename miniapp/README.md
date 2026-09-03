# Data Asset Portal Pocket

微信小程序端的只读 MVP，定位是“随身数据资产目录”。它是独立的小程序端工程，不是对现有 React Web 的移动端适配。

## 当前范围

已实现五页：

- 首页：公开门户统计、全局搜索入口、数据表/指标/报表/API 入口、最近查看
- 全局搜索：调用 `/api/search`，支持防抖、分类筛选、loading/empty/error/retry
- 数据资产列表：调用 `/api/assets/tables`，支持关键词、层级、主题域和加载更多
- 资产详情：字段列表、业务描述、真实 DDL 展开、公开接口已有的技术信息
- 指标中心：调用 `/api/indicators`，支持搜索、inline 展开和独立的运行状态/生命周期标签

本期只读使用 FastAPI Public Catalog GET 接口，不包含微信登录、写操作、系统管理、独立 RBAC、完整血缘、字段映射维护或 shared contracts 重构。当前公开资产合约没有状态字段，因此资产列表会明确显示“状态：接口未提供”，不伪造筛选结果或数字。

## 技术栈与要求

- Taro 4.2.1
- React 18 + TypeScript + SCSS
- 第一阶段只编译微信小程序 `weapp`
- Node.js `>=18`；仓库当前本机使用 Node 24、npm 11

## 安装与运行

在仓库根目录执行：

```powershell
npm --prefix miniapp ci
npm --prefix miniapp run typecheck
npm --prefix miniapp run lint
npm --prefix miniapp test
npm --prefix miniapp run build:weapp
```

本地监听编译：

```powershell
npm --prefix miniapp run dev
```

编译输出目录是 `miniapp/dist/`。微信开发者工具应导入 `miniapp/dist/`，不是 `miniapp/`。`project.config.json` 的 `miniprogramRoot` 已按此配置。

## API Base URL

Taro 只会把 `TARO_APP_` 前缀变量编译进小程序。可复制 `.env.example` 为 `.env.development` 或 `.env.development.local`，按环境设置：

```text
TARO_APP_API_BASE_URL=http://127.0.0.1:15099/api
TARO_APP_ID=touristappid
```

生产构建前使用 `.env.production` 或 `.env.production.local`，将 `TARO_APP_API_BASE_URL` 改为部署后的 HTTPS 地址，例如 `https://your-domain.example.com/api`，并设置真实 `TARO_APP_ID`。源码不写死生产域名，也不包含任何认证 token。

本地后端可按根 README 启动：

```powershell
uvicorn backend.asgi:app --host 127.0.0.1 --port 15099
```

微信开发者工具访问宿主机地址时，开发阶段可按工具提示勾选“不校验合法域名、web-view、TLS 版本以及 HTTPS 证书”。这只用于本地开发，不是生产方案。

生产环境必须满足微信公众平台的 request 合法域名要求：使用 HTTPS、配置合法 request 域名，不能依赖任意 HTTP 地址。

## Figma 与目录

视觉来源：[dataasset Figma design](https://www.figma.com/design/I8tcpKdEsNpQiDmItgmUMm/dataasset?node-id=0-1)。本次执行环境的 Figma Connector 没有该文件的编辑权限，未能自动读取 design context；实现按仓库 UI 规范、给定页面规格和微信运行时约束完成。

```text
miniapp/
├─ config/index.ts
├─ src/
│  ├─ api/                 # Taro.request 独立 adapter 与 DTO mapper
│  ├─ components/          # 搜索、状态、卡片、底部导航
│  ├─ pages/               # home/search/assets/asset-detail/indicators
│  ├─ utils/               # route-independent storage/status helpers
│  ├─ app.config.ts
│  └─ app.ts
├─ tests/
├─ project.config.json
├─ package.json
└─ README.md
```
