# AI 问答静态 Mock 演示（Issue #542）

该适配器仅为 \`VITE_API_MODE=mock\` 的公开静态演示提供单轮问答 UI。不会执行真实 AI、RAG、BGE、LLM、SQL 或业务统计。

- 本地开发：\`cd frontend && VITE_API_MODE=mock npm run dev\`。
- **显式静态 Demo 构建**：\`cd frontend && VITE_API_MODE=mock DAP_STATIC_MOCK_BUILD=1 npm run build:frontend\`。这条构建只允许作为隔离静态演示产物发布，不能作为真实后端的生产 Bundle；静态托管发布仍需人工进行。
- 正常 Remote Build：\`cd frontend && VITE_API_MODE=remote npm run build:frontend\`，与旧版本相同；Mock 构建授权变量不会改变 Remote 分流。
- Mode 选择必须显式：只有 Mock 走动态导入 \`frontend/src/mock/aiAsk.ts\`；Remote 不调用、不回退演示逻辑，Remote API 状态失败也不会切换 Mock。
- 演示资产及 fieldId/assetId 取自现有 \`getAssetTables()\` 的 Mock 目录身份，而不是在问答模块内复制资产列表或任意生成 ID。回复是基于演示词汇/元数据的确定性示例，未知问题拒答，列表结果标记为有界，统计问题不编造数量。
- 进度事件与 Remote UI 共用形状，但只由 Mock 模块在本地生成；支持 AbortSignal 取消。页面明确提示“模拟演示 · 非真实 AI 回答”。

## 验证建议

运行 \`npm test\`、\`npm run typecheck:app\`、\`npm run lint\`。分别使用 \`VITE_API_MODE=remote\` 和显式 Demo 构建命令构建，并检查 **Remote dist 不含 Mock AI 语料/适配模块**、远程真实 SSE /ai/ask/stream 与 /ai/status 请求保持不变。再以浏览器验证 Demo 的表字段引用下钻、取消、零证据和标签。未完成的构建、E2E、部署或内网联调不可标记为已通过。
