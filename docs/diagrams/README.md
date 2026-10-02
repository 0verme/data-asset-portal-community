# 架构图维护

- `architecture.json`：Archify architecture 图源，包含 10 个组件、支持性卡片及固定提交的源码证据。
- `architecture.html`：Archify 生成的自包含交互文件。下载后本地打开；GitHub 文件页不执行 HTML。
- `../images/system-architecture.svg`：README 用的紧凑静态排版，与图源保持同一组件及关系语义；不包含脚本、远程字体或外部资源，配色来自 `frontend/src/styles/app.css` 浅色 token。

修改结构时同时更新 JSON 和 SVG。源码证据基线固定在 JSON 的 `meta.repository.revision`；升级基线时重新检查组件行为，尤其是访问策略。

安装 Archify 后，在仓库根目录执行（将 `<archify>` 替换为技能目录）：

```sh
node <archify>/bin/archify.mjs validate architecture docs/diagrams/architecture.json --quality showcase --repo-root . --json
node <archify>/bin/archify.mjs deliver architecture docs/diagrams/architecture.json docs/diagrams/architecture.html --quality showcase --repo-root . --json
```

自动检查须达到 9/9、零错误、零警告。另需检查 SVG 在 README 宽度下的中文可读性；自动校验不等于 HTML 交互视觉验收。
