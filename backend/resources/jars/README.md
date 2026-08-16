# JDBC 驱动目录（不包含驱动文件）

本目录不随仓库分发任何商业 JDBC 驱动二进制。

GaussDB / DWS 的 JDBC 驱动（如 `gaussdb200.jar`）为第三方商业软件，
其再分发许可未在本仓库内声明，因此**不随源码仓库提供**。

## 获取方式

请从官方渠道自行下载对应数据库版本的 JDBC 驱动：

- 华为云 GaussDB 官方文档 / 软件下载页
- 或联系您的数据库服务商获取受支持版本

## 配置方式

下载后将驱动放到本目录（或任意本地路径），并通过以下任一方式指定：

1. 环境变量（推荐）：

   ```bash
   export ASSET_DB_JAR_PATH=/opt/data-asset-portal/backend/resources/jars/gaussdb200.jar
   ```

2. `backend/configs/database.yaml` 中 gaussdb profile 的 `jar_path` 字段：

   ```yaml
   gauss_primary:
     type: gaussdb
     jar_path: /opt/data-asset-portal/backend/resources/jars/gaussdb200.jar
     jdbc_url: jdbc:gaussdb://127.0.0.1:25308/asset_portal?currentSchema=dwp
   ```

未配置驱动时，GaussDB profile 连接会失败并给出明确错误提示（见
`backend/app/db/facade.py`）。
