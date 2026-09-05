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
npm --prefix miniapp ci --include=dev
npm --prefix miniapp run typecheck
npm --prefix miniapp run lint
npm --prefix miniapp test
npm --prefix miniapp run build:weapp
```

## 依赖安全审计

小程序依赖树同时包含 Taro 的构建工具链和运行时包。审计必须覆盖
`package-lock.json` 实际解析的完整开发依赖树；不要使用
`npm audit fix --force` 自动降级 Taro 主版本：

```bash
npm --prefix miniapp audit --include=dev --audit-level=high
```

本次保留 Taro `4.2.1`、React `18` 和 Node `>=18`，仅对已验证的兼容链路使用
`overrides`：

| 依赖链 | 收口方式 | 验证范围 |
| --- | --- | --- |
| `@tarojs/components` → `swiper` | `12.1.2` | weapp build 通过；未修改小程序源码引用 |
| `@tarojs/helper` / runner → `esbuild` | `0.25.0` | typecheck、lint、test、weapp build 通过 |
| CLI → `adm-zip`；plugin-doctor → `glob` | `adm-zip 0.6.0`、`glob 10.5.0` | 使用精确父依赖范围，`npm ls` 无 invalid |
| runner → `serialize-javascript` | `7.0.5` | weapp build 通过 |
| runner → `miniprogram-simulate` → `postcss` / `less` | `postcss 8.5.28`、`less 4.9.0` | weapp build 通过 |
| `sockjs` → `uuid` | `11.1.1` | webpack-dev-server / weapp build 加载回归通过 |
| `cacheable-request` → `http-cache-semantics` | `4.1.1` | `got` 与 cache adapter 加载回归通过 |
| runner → `html-minifier` | `html-minifier-terser 7.2.0` alias | Taro 4.2.1 weapp 路径不加载旧模块；weapp build 通过 |

Taro CLI 的模板下载链路没有可用的上游修复，因此使用仓库内可审计的最小适配层：

- `miniapp/overrides/decompress` 以 CommonJS 适配器调用维护中的
  `@xhmikosr/decompress@10.2.1`，保留 `download@7` 所需的异步函数 API，并启用归档
  路径、符号链接/硬链接和特殊文件权限防护。
- `miniapp/overrides/git-clone` 使用 `spawn` 参数数组和 `--` 选项终止符，拒绝
  `opts.args` 及危险 checkout ref，保留 `download-git-repo` 成功回调契约；不经 shell
  执行用户输入。

在 Node 22 / npm 10、显式包含 dev 依赖的本次锁文件验证中，`npm audit` 结果为
`critical=0`、`high=0`、`moderate=21`、`low=2`。剩余 moderate 主要来自 Taro
4.2.1 声明的精确 `webpack@5.91.0` / `webpack-dev-server@4.15.2` 兼容边界、CLI
旧版 `got` 链路，以及适配器依赖的 `file-type`；跨大版本替换会破坏 Taro 构建契约，
因此不在本次范围内。构建工具仅用于受控本地/CI 构建，不应将小程序开发服务暴露到
不可信网络。

上述适配器和 overrides 均可独立回滚；待 Taro 上游提供稳定且兼容的安全依赖链后，
应重新执行完整审计、安装和 weapp 产物验收。

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
├─ overrides/             # Taro CLI archive/clone security adapters
├─ project.config.json
├─ package.json
└─ README.md
```
