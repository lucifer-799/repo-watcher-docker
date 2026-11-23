# data/ —— 运行时数据目录

本目录是容器内 `/app/data` 的挂载源，存放 Repo Watcher 的 SQLite 数据库
（`repo-watcher.db`，含配置、仓库数据、管理员凭据与会话）。

## 注意

- **目录属主必须是 `1000:1000`**：容器以非 root 的 `node` 用户运行，属主不匹配会导致
  SQLite 无法写入、容器健康检查失败。首次部署执行：
  ```bash
  mkdir -p ./data && sudo chown -R 1000:1000 ./data
  ```
- **不要提交数据库到版本库**：`.gitignore` 已排除 `data/*.db`、`*.db-wal`、`*.db-shm`。
  本目录仅保留本说明文件。
- **迁移**：从旧部署迁移时，停掉容器 → 把旧 `repo-watcher.db` 拷入本目录 →
  确认属主为 `1000:1000` → 启动容器。
- **备份**：直接拷贝 `data/` 整个目录即可（建议在容器停止时进行，或用 SQLite 的
  `.backup` 命令做在线备份）。