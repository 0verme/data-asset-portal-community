# DAP 首页 V2.2 浏览器验收

实现提交 `cd1e22d7f93220a3c56dae253765e7c8d415023c`，对照基线 `9a4eb47e49af311c615d4040ba06aa84c23d7bf8`。应用通过 Chromium 158.0.8127.18 渲染。主对照为 1440 × 1024、DPR 1、Light / Purple / Comfortable / Subtle，Remote 使用本地受控响应。首屏图在输入失焦后的静息态采集。手机长图沿用相同宽度，扩展截图高度以显示滚动区内的 Footer。

## 截图

| 场景 | 证据 |
| --- | --- |
| 1440px 原型与实际并排 | [完整并排图](desktop-comparison.png) |
| 1440px 原图 | [HTML 原型](prototype-1440.png) · [只读审计基线](baseline-1440-light.png) · [实施后 Light](app-1440-light.png) |
| 桌面外观 | [Dark / Purple / Comfortable](app-1440-dark.png) · [Dark / Blue / Compact](app-1440-compact.png) |
| 平板与手机 | [768px 长图](app-768.png) · [390px 首屏](app-390-viewport.png) · [390px 长图](app-390.png) · [320px 首屏](app-320-viewport.png) · [320px 长图](app-320.png) |
| 统计数量 | [Remote 12 项](app-1440-light.png) · [Mock 11 项](app-1440-mock-11.png) · [Remote 2 项](app-1440-remote-2.png) · [Remote 0 项](app-1440-remote-0.png) |
| 窄屏导航 | [320px 首页 More](app-menu-320.png) · [390px 业务页导航](business-390-drawer.png) |
| 业务和异常路由 | [桌面数据仓库](business-1440.png) · [404](app-404-1440.png) |
| 结果态 | [搜索](search-1440.png) · [Ask AI 桌面](ask-ai-1440.png) · [Ask AI 390px](ask-ai-390.png) |

## 1440px 实测

单位 px。球芯直径由透明度或 shader 几何估算。

| 元素 | HTML | 实际 DAP | 差异 |
| --- | --- | --- | --- |
| Header x / 宽 × 高 | 40 / 1360 × 68 | 40 / 1360 × 68 | 0 |
| 导航中心 x / 宽 × 高 | 720 / 554.0 × 44 | 720 / 550.6 × 44 | 中心一致，实际菜单宽 −3.4 |
| 光球舞台 y / 宽 × 高 | 88 / 1120 × 248 | 88 / 1120 × 248 | 0 |
| 球体画布 / 估算球芯 | 246² / ≈205–219 | 348² / ≈209 | WebGL 透明画布与动态光晕 |
| 标题 y / 字号 / 字重 | 336 / 57 / 700 | 336 / 57 / 700 | 0 |
| 搜索框 x、y / 宽 × 高 / 圆角 | 265、472.1 / 910 × 61 / 22 | 265、472.1 / 910 × 61 / 22 | 0 |
| Scope / 热门词 y | 550.1 / 598.1 | 550.1 / 598.1 | 0 |
| 统计面板 x、y / 宽 × 高 / 圆角 | 160、662.1 / 1120 × 234 / 23 | 160、662.1 / 1120 × 234 / 23 | 0 |
| 统计字号 / 数字字重 | 13 / 34 / 650 | 13 / 34 / 650 | 0 |
| Footer 外层 y / 底部留白 | 966.1 / 27 | 969.0 / 27 | 外层 +2.9，内容均居中 |

768、390、320px 的统计面板 y 分别为 602.2、639.3、673.3，对照 HTML 的 602.3、635.3、635.3。手机按钮高度为 44px。320px 热门词按 API 文案自然换行，面板随内容流移动。1440/861/860/768/601/600/390/320px 对应 6/6/3/3/3/2/2/2 列，均无横向溢出。暗色和 Compact 使用实际 Appearance。导航、Logo、内容、主题 Token 和动态球体均来自真实应用。 [原始浏览器采样](chromium-metrics.json)

[Issue #609](https://github.com/0verme/data-asset-portal-community/issues/609)
