# Repo Watcher · Docker 版

> **来源声明（请务必阅读）**
>
> 本项目基于 **Repo Watcher · 项目仓库更新监控**（原作者 **MagicCode**，上游地址
> <https://cnb.cool/magiccode1412/repo-watcher>，许可证 **MIT License**）二次开发，
> 改造为 **Docker 容器版本**。**原项目版权归原作者 MagicCode**，本衍生作品同样以 MIT 许可发布，
> 完整条款见仓库根目录 [`LICENSE`](./LICENSE)（必须随代码保留）。修改内容详见 [`NOTICE`](./NOTICE)。

一个多平台仓库更新监控工具：跟踪 GitHub / Gitee / GitLab / GitCode / CNB 的仓库提交与发布，
定时检测更新并通过通知渠道推送。本仓库把它从飞牛 fpk 应用形态改造为**独立 Docker 服务**。

---

## 与原版的差异

| 方面 | 原版（fpk） | 本仓库（Docker 版） |
|---|---|---|
| 部署形态 | 飞牛 fnOS fpk 应用包，进程由应用中心托管 | Docker 容器（`Dockerfile` + `compose.yaml`） |
| 监听方式 | Unix Socket（仅网关注解可达） | TCP（`PORT`，通常经反向代理暴露） |
| 访问路径 | `/app/repowatcher/` 前缀 | 固定 `/`（不再支持前缀构建） |
| 未登录访问 | 全部需登录 | **仪表盘只读开放**（仓库列表/状态/统计可见）；管理后台与写操作仍需登录 |
| 运行身份 | 平台用户 | **非 root**（容器内 `node`，uid=1000） |
| 安全加固 | — | 1.0.2 起持续加固（详见 [CHANGELOG](./CHANGELOG.md)） |
| fpk 资产 | `fnos/`、`build:fnos`、fnpk 流水线 | **已移除** |

### 版本与安全加固

本项目自 1.0.2 起持续进行安全加固（令牌类型校验、初始化原子化、非 root 运行、
refresh 轮换、并发写保护、登录限流等），1.1.x 进一步收紧了启动守卫与代理信任边界、
并移除了全部 Edge/EdgeOne 相关代码。

> **完整版本变更记录见 [CHANGELOG.md](./CHANGELOG.md)**

---

## 快速开始（Docker）

**方式一：直接用公网镜像（推荐，无需克隆源码）**

```bash
mkdir -p ./data && sudo chown -R 1000:1000 ./data
# 从仓库获取 compose.yaml，或仅用 docker run：
docker run -d --name repo-watcher -p 8080:8080 \
  -v "$PWD/data:/app/data" \
  -e TRUST_GATEWAY_HEADERS=0 -e TRUST_PROXY_HEADERS=false \
  --restart unless-stopped \
  ghcr.io/lucifer-799/repo-watcher-docker:latest
```

镜像由 GitHub Actions 自动构建并发布到 ghcr.io：推 `main` 会更新 `latest`，推 `v*` 标签会生成
对应的版本标签（如 `1.1.3`、`1.1`）。`compose.yaml` 默认使用 `latest`（跟随最新发布）；
如需可复现的固定版本，把镜像改为具体 tag（如 `:1.1.3`）或用 `REPO_WATCHER_TAG=1.1.3` 覆盖。

**方式二：从源码本地构建**

```bash
# 1) 数据目录（容器以 uid 1000 运行，属主必须匹配，否则 SQLite 写不进）
mkdir -p ./data && sudo chown -R 1000:1000 ./data

# 2) 构建并启动
docker compose up -d --build

# 3) 打开 http://<宿主IP>:8080
#    首次访问会引导创建管理员账号
```

也可不用 compose：

```bash
docker build -t repo-watcher:1.1.3 .
docker run -d --name repo-watcher -p 8080:8080 \
  -v "$PWD/data:/app/data" \
  -e TRUST_GATEWAY_HEADERS=0 \
  -e TRUST_PROXY_HEADERS=false \
  --restart unless-stopped repo-watcher:1.1.3
```

### 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `PORT` | `8080` | 容器内监听端口 |
| `HOST` | `0.0.0.0` | 监听地址 |
| `DB_PATH` | `/app/data/repo-watcher.db` | SQLite 库路径（务必落在卷内） |
| `WWW_DIR` | `/app/www` | 前端构建产物目录（镜像内已内置） |
| `TRUST_GATEWAY_HEADERS` | `0` | **TCP 模式必须为 0**；为 1 时服务拒绝启动（防止伪造网关注入管理员身份） |
| `CONFIG_ENC_KEY` | 自动生成 | 凭据加密密钥（32 字节以上）；不配则首次启动生成到 `etc/app.env`，请自行备份 |
| `JWT_SECRET` | 自动生成 | JWT 签名密钥，同上 |
| `HOST_PORT`（compose 用） | `8080` | 宿主端口 |

### 数据卷

- `./data` → `/app/data`：SQLite 数据库（配置、仓库数据、会话）全部在此。
  迁移时把既有 `repo-watcher.db` 拷入并保持属主 `1000:1000` 即可。
- 凭据密钥文件默认在容器内 `etc/app.env`；如需持久化可另行挂载。

### 健康检查

镜像内置 `HEALTHCHECK`，探测 `GET /api/health`。

---

## 使用说明

1. 首次打开页面 → 创建管理员账号（≥6 位密码）。
2. 进入 **管理后台** → 选择平台标签（GitHub / Gitee / GitLab / GitCode / CNB）→ 添加仓库
   （格式 `owner/repo`，可选分支、备注）。
3. 填���对应平台的访问令牌（可选，私有仓库需要）、通知配置（MagicPush 或自定义 webhook）。
4. 在「定时检测」中设置间隔与开关；也可手动触发检测。
5. **未登录访客**打开首页只能查看仪表盘（仓库列表、最近提交/发布、检测状态），
   看不到管理后台菜单，也无法执行任何修改（后端接口同样返回 401）。

---

## 开发

```bash
npm ci
npm run dev      # 本地开发（vite）
npm run build    # 构建前端到 dist/
npm test         # 跑全部测试（存储契约 / 鉴权 / 服务冒烟 / 代理 / 安全回归）
npm run test:security   # 只跑安全回归（JWT 类型、fail-fast、匿名只读、限流、轮换、原型污染等）
```

`server/` 为 Node 后端（`node:sqlite`，需 Node 22+），其中：
- `server/index.js` HTTP 服务入口（Socket/TCP 双模式）
- `server/router.js` 路由分派、`server/scheduler.js` 定时检测、`server/storage/sqlite.js` 存储驱动
- `server/lib/` 业务基础库（config / auth / services / utils）
- `server/api/` 各 API 端点处理函数

`test/` 为测试套件（**不打包进镜像**）：
- `test/storage-driver-contract.test.mjs` 存储驱动契约
- `test/auth-mode.test.mjs` 鉴权模式与网关身份
- `test/server-smoke.test.mjs` 服务端冒烟（静态/路由/持久化）
- `test/http-proxy.test.mjs` HTTP 代理
- `test/security.test.mjs` 安全回归（锁住 1.0.1→1.1.2 的修复：JWT 令牌类型、启动 fail-fast、
  匿名只读边界、写端点鉴权、init 并发、登录限流、refresh 轮换、原型污染防护、health、非 root）

`src/` 为 Vue 3 前端。**本项目只支持 Node/Docker 运行时**，不再包含 Edge/EdgeOne 相关代码。

---

## 许可证

[MIT License](./LICENSE) —— 原项目版权归原作者 **MagicCode**，
本 Docker 版衍生作品的修改部分版权归本仓库维护者。再分发请保留 `LICENSE` 与 `NOTICE`。