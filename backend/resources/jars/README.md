# JDBC 驱动目录（不包含驱动文件）

本目录不随仓库分发任何商业 JDBC 驱动二进制。

GaussDB / DWS 的 JDBC 驱动（如 `gaussdb200.jar`）为第三方商业软件，
其再分发许可未在本仓库内声明，因此**不随源码仓库提供**。

## 获取方式

请从官方渠道自行下载对应数据库版本的 JDBC 驱动：

- 华为云 GaussDB 官方文档 / 软件下载页
- 或联系您的数据库服务商获取受支持版本

## 配置方式

将驱动放到 `backend/resources/jars/` 后，在 `backend/configs/database.yaml` 的 GaussDB profile 中推荐使用相对于 `backend/` 的路径：

```yaml
profiles:
  gauss_primary:
    type: gaussdb
    driver: com.huawei.gauss200.jdbc.Driver
    jar_path: resources/jars/gaussdb200.jar
    jdbc_url: jdbc:gaussdb://127.0.0.1:25308/asset_portal?currentSchema=dwp
    schema: dwp
```

相对路径以 `backend/` 为基准（即 `backend/configs/database.yaml` 的上两级目录），不依赖启动时的当前工作目录；Linux 和 Windows 均无需修改仓库源码。

也可以通过 `ASSET_DB_JAR_PATH` 指定部署环境自己的绝对路径。该变量优先于 profile 中的 `jar_path`。例如 Linux：

```bash
export ASSET_DB_JAR_PATH=/opt/data-asset-portal/backend/resources/jars/gaussdb200.jar
```

或 Windows PowerShell：

```powershell
$env:ASSET_DB_JAR_PATH = 'C:\data-asset-portal\backend\resources\jars\gaussdb200.jar'
```

未配置可用驱动时，GaussDB profile 连接会失败并给出明确错误提示（见
`backend/app/db/providers.py`）。
