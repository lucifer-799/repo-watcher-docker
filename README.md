# Repo Watcher - Docker 版

> **来源声明（请务必阅读）**
>
> 本项目基于 **Repo Watcher - 项目仓库更新监控**（原作者 **MagicCode**，上游地址
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

**无需本地构建**——直接拉取公网镜像（由 GitHub Actions 自动构建发布到 ghcr.io）。

**方式 A：docker run（最简）**

```bash
# 容器以非 root（uid 1000）运行，数据目录属主必须匹配，否则 SQLite 写不进
mkdir -p ./data && sudo chown -R 1000:1000 ./data

docker run -d --name repo-watcher \
  -p 8080:8080 \
  -v "$PWD/data:/app/data" \
  -e TZ=Asia/Shanghai \
  -e TRUST_GATEWAY_HEADERS=0 \
  ghcr.io/lucifer-799/repo-watcher-docker:latest
```

打开 `http://<主机IP>:8080`，首次访问会引导创建管理员账号。

**方式 B：docker compose（推荐，配置可版本化）**

```bash
mkdir -p ./data && sudo chown -R 1000:1000 ./data
curl -fsSLO https://raw.githubusercontent.com/lucifer-799/repo-watcher-docker/main/compose.yaml
docker compose up -d
```

`compose.yaml` 直接使用 `ghcr.io/lucifer-799/repo-watcher-docker:latest`，无需改任何变量。

**关于镜像标签**：`latest` 跟随最新发布。需要可复现/稳定的固定版本时，把 `compose.yaml` 里的
镜像直接改成具体版本即可（如 `ghcr.io/lucifer-799/repo-watcher-docker:1.1.4`）。

**首次部署必看**：数据目录属主需为 `1000:1000`（容器以 `node` 用户运行）；
健康检查端点为 `GET /api/health`；容器已内置 `HEALTHCHECK`。

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

- `./data` -> `/app/data`：SQLite 数据库（配置、仓库数据、会话）全部在此。
  迁移时把既有 `repo-watcher.db` 拷入并保持属主 `1000:1000` 即可。
- 凭据密钥文件默认在容器内 `etc/app.env`；如需持久化可另行挂载。

### 健康检查

镜像内置 `HEALTHCHECK`，探测 `GET /api/health`。

---

## 使用说明

1. 首次打开页面 -> 创建管理员账号（>=6 位密码）。
2. 进入 **管理后台** -> 选择平台标签（GitHub / Gitee / GitLab / GitCode / CNB）-> 添加仓库
   （格式 `owner/repo`，可选分支、备注）。
3. 填写对应平台的访问令牌（可选，私有仓库需要）、通知配置（MagicPush 或自定义 webhook）。
4. 在「定时检测」中设置间隔与开关；也可手动触发检测。
5. **未登录访客**打开首页只能查看仪表盘（仓库列表、最近提交/发布、检测状态），
   看不到管理后台菜单，也无法执行任何修改（后端接口同样返回 401）。

---

## 开发

> 仅在你需要修改代码或自行构建镜像时才需要本节；普通部署请直接用上面的公网镜像。

**从源码本地构建镜像**

```bash
mkdir -p ./data && sudo chown -R 1000:1000 ./data
docker compose -f compose.build.yaml up -d --build   # 从源码构建（含 build 段）
```

或不用 compose：

```bash
docker build -t repo-watcher:1.1.5 .
docker run -d --name repo-watcher -p 8080:8080 \
  -v "$PWD/data:/app/data" \
  -e TRUST_GATEWAY_HEADERS=0 \
  --restart unless-stopped repo-watcher:1.1.5
```

**本地开发与测试**

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
- `test/security.test.mjs` 安全回归（锁住 1.0.1->1.1.2 的修复：JWT 令牌类型、启动 fail-fast、
  匿名只读边界、写端点鉴权、init 并发、登录限流、refresh 轮换、原型污染防护、health、非 root）

`src/` 为 Vue 3 前端。**本项目只支持 Node/Docker 运行时**，不再包含 Edge/EdgeOne 相关代码。

---

## 关于本项目

本项目的工程流程采用「**智能体协作 + 人工决策**」的方式完成，作为项目本身的实践特色：

- **需求决策与验收**由人工负责；
- **代码重构与功能开发**由 AI 智能体完成；
- **代码审查**采用自动化方式（[OCR](https://github.com/alibaba/open-code-review) 提取 + 大语言模型评审）逐轮发现并修复问题；
- **镜像构建**由 Jenkins 流水线完成，**运行部署**通过 Docker 容器化方式交付。

上述流程在自建的智能体协作平台上编排（[Octop](https://github.com/TencentCloud/Octop)），AI 负责执行、人工负责判断与签署，
二者边界清晰。此处仅描述方法论层面的分工，不涉及任何具体基础设施配置。

---

## 许可证

[MIT License](./LICENSE)

- 原作 **Repo Watcher** © 2026 **MagicCode**（MIT）
- Docker 版 © 2026 **lucifer-799**

再分发请同时保留 `LICENSE` 与 `NOTICE`（内含两方版权与修改说明）。