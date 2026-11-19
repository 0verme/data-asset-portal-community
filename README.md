# Issue #611 · 浏览器验证

基线为 `origin/main` 提交 `5bc01ad`，修复提交为 `7be60d1`。测试环境为 macOS 27.2.1、Node 24.22.3、Playwright 1.65.0、Chromium 158.0.8127.18 和 WebKit 27.2。业务页使用 Vite Preview 的生产构建和仓库 Mock 数据。Dialog、DropdownMenu 和 Popover 的截图来自 DAP overlay 开发 Fixture。

- [构建后的 CSSOM 层级及匹配声明](cascade.json)
- [修复前计算样式和 DOM](before/metrics.json) · [修复后计算样式和 DOM](after/metrics.json)
- [40 组遗留路由间距和几何抽样](layout-audit.json) · [TableEditor 双浏览器交互记录](interaction-audit.json)
- [窄屏菜单选项命中对比](hit-test.txt) · [仅移动 Reset 时的遮挡复现](reset-only-hit-test.txt)

## Chromium · 1440px · 浅色

| 场景 | 修复前 | 修复后 |
| --- | --- | --- |
| TableEditor 主题域 | [截图](before/chromium-light-dark-1440-editor-domain.png) | [截图](after/chromium-light-dark-1440-editor-domain.png) |
| TableEditor 数据层级 | [截图](before/chromium-light-dark-1440-editor-layer.png) | [截图](after/chromium-light-dark-1440-editor-layer.png) |
| 仓库资产每页条数 | [截图](before/chromium-light-dark-1440-pagination.png) | [截图](after/chromium-light-dark-1440-pagination.png) |
| 操作日志结果筛选 | [截图](before/chromium-light-dark-1440-filter.png) | [截图](after/chromium-light-dark-1440-filter.png) |
| 遗留新增用户 FormModal | [截图](before/chromium-light-dark-1440-legacy-form.png) | [截图](after/chromium-light-dark-1440-legacy-form.png) |
| API 资产原生 Select | [截图](before/chromium-light-dark-1440-native-select.png) | [截图](after/chromium-light-dark-1440-native-select.png) |

## WebKit · 390px · 深色

| 场景 | 修复前 | 修复后 |
| --- | --- | --- |
| TableEditor 主题域 | [截图](before/webkit-dark-light-390-editor-domain.png) | [截图](after/webkit-dark-light-390-editor-domain.png) |
| TableEditor 数据层级 | [截图](before/webkit-dark-light-390-editor-layer.png) | [截图](after/webkit-dark-light-390-editor-layer.png) |
| 仓库资产每页条数 | [截图](before/webkit-dark-light-390-pagination.png) | [截图](after/webkit-dark-light-390-pagination.png) |
| 操作日志结果筛选 | [截图](before/webkit-dark-light-390-filter.png) | [截图](after/webkit-dark-light-390-filter.png) |
| 遗留新增用户 FormModal | [截图](before/webkit-dark-light-390-legacy-form.png) | [截图](after/webkit-dark-light-390-legacy-form.png) |
| API 资产原生 Select | [截图](before/webkit-dark-light-390-native-select.png) | [截图](after/webkit-dark-light-390-native-select.png) |

## WebKit · 390px · 跟随系统浅色

| 场景 | 修复前 | 修复后 |
| --- | --- | --- |
| DAP Dialog | [截图](before/webkit-system-light-390-dialog.png) | [截图](after/webkit-system-light-390-dialog.png) |
| DAP Popover | [截图](before/webkit-system-light-390-popover.png) | [截图](after/webkit-system-light-390-popover.png) |
| DAP DropdownMenu | [截图](before/webkit-system-light-390-dropdown.png) | [截图](after/webkit-system-light-390-dropdown.png) |

## Chromium · 1440px · 跟随系统深色

| 场景 | 修复前 | 修复后 |
| --- | --- | --- |
| TableEditor 主题域 | [截图](before/chromium-system-dark-1440-editor-domain.png) | [截图](after/chromium-system-dark-1440-editor-domain.png) |

