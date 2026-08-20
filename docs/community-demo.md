# Community Demo 指南

本指南使用仓库内的虚构全渠道零售数据，走完 **migration → seed → backend → frontend** 的完整链路。
所有数据来自 `demo/datasets/`，不包含真实公司、账号、地址或业务数据。

> 本文是可复现的多步骤开发流程。OS-03 one-command demo 不属于本文或本次任务范围。

## 演示数据

- 30 张 DWD / DWM / DWS 主题表，覆盖 8 个主题域
- 251 个字段、40 个词根、16 个指标和 10 个 API 资产
- 8 个数据源、48 个字段映射、9 类 / 33 项参数字典
- 关系数据包含指标路径和有限血缘示例

执行 Public Data Guard 可检查演示数据和公开仓库安全边界：

```bash
python demo/validate_demo_data.py --strict
```

## SQLite（推荐本地体验）

### 1. 安装后端依赖

```bash
python -m venv backend/.venv
# Windows PowerShell
.\backend\.venv\Scripts\Activate.ps1
# macOS / Linux
source backend/.venv/bin/activate
pip install -r backend/requirements.txt
```

### 2. 配置 Community profile

```bash
# macOS / Linux
cp backend/.env.example backend/.env.local
# Windows PowerShell
Copy-Item backend/.env.example backend/.env.local
```

在 `backend/.env.local` 中设置本地值：

```env
FLASK_SECRET_KEY=<generate-a-strong-random-value>
FLASK_ENV=development
ASSET_RUNTIME_PROFILE=community
ASSET_DB_PROFILE=community_sqlite
ASSET_DB_DATABASE=<absolute-path>/community.db
```

`FLASK_SECRET_KEY` 只保存于本地环境文件或 secret store，不要提交到 Git。

### 3. 迁移并写入演示数据

```bash
python backend/scripts/schema_migrate.py apply --profile community_sqlite
python demo/seed_sqlite.py --database <absolute-path>/community.db
```

### 4. 启动后端和前端

后端默认监听 `127.0.0.1:5099`：

```bash
python backend/run.py
```

另开终端，配置前端 remote 模式：

```bash
cp frontend/.env.example frontend/.env.local
# 设置 VITE_API_MODE=remote
npm --prefix frontend run dev
```

Windows PowerShell 的复制命令为：

```powershell
Copy-Item frontend/.env.example frontend/.env.local
npm --prefix frontend run dev
```

打开 Vite 输出的地址，使用演示账号 `community_demo / demo-change-me` 登录。
该账号仅用于本地演示；共享环境或部署环境必须替换密码和 secret。

## 重置演示数据库

删除本地 `community.db` 后，重新执行“迁移并写入演示数据”步骤即可恢复。SQLite seed 使用固定主键和
`INSERT OR IGNORE`，重复执行不会追加重复数据。

## PostgreSQL

PostgreSQL 的 Community 初始化仍使用受管 migration 和 demo seed：

```bash
python backend/scripts/schema_migrate.py apply --profile community_postgres
python demo/seed_postgres.py --dialect postgres
```

`seed_postgres.py` 默认输出 SQL；请将输出审阅后再导入专用的 Community 数据库。不要把生产连接串、
密码或真实数据粘贴到命令、Issue、日志或文档中。PostgreSQL 的集成验证依赖隔离测试库，详见
[开发指南](../DEVELOPMENT.md#数据库集成测试)。

## 可选模块的边界

Community profile 默认禁用 `upstream`、`push`、`report` 和 `codeTable`。这些模块的源码在公开仓库中按
Apache-2.0 License 提供，但默认运行时不注册对应路由、菜单或 Community migration 表。
“Optional” 描述 runtime profile，不是 commercial edition、closed-source 或不同 license 的说法。

可选模块的 PostgreSQL / GaussDB / DWS DDL 位于 `docs/pg/` 和 `docs/dws/`，是完整部署的参考资料，
不是 Community 新安装的替代初始化入口。模块边界和所有权见 [模块清单](./modules.md) 与
[数据库迁移说明](../backend/migrations/)。

## 相关文档

- [开发指南](../DEVELOPMENT.md)：环境变量、mock / remote、测试和常用脚本
- [部署说明](../DEPLOYMENT.md)：构建、Nginx 反代和部署注意事项
- [截图画廊](./screenshots.md)：演示页面截图
- [架构说明](./architecture.md)：数据流、模块边界和数据库初始化原则
