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
| 安全加固 | — | v1.0.2 起持续加固，见下 |
| fpk 资产 | `fnos/`、`build:fnos`、fnpk 流水线 | **已移除** |

### 版本与安全加固

- JWT 校验令牌类型（refresh token 不可当 access token 用）
- 通知模板渲染防原型污染（拒绝 `__proto__`/`constructor`/`prototype` 路径）
- 管理员初始化原子化（CAS），并发下不会被覆盖
- 容器非 root 运行
- 多值 `Set-Cookie` 逐条写出
- refresh token 一次性轮换
- 配置/仓库数据写入走事务内「读-改-写」，消除并发丢更新
- 登录失败限流（5 次后指数退避，上限 15 分钟）
- PBKDF2 迭代提升至 60 万（旧哈希仍可正常验证，改密后自动升级）
- 匿名响应隐藏内部错误详情（`lastCheckError` 等）

**v1.1.0**：整理为可对外发布的形态 —— 移除全部 fpk 资产，重写 README（含来源声明）与
`NOTICE`，内部地址/CI 配置占位化，新增 `.env.example`；并以全新历史发布（旧开发历史已归档）。

**v1.1.1**：修复代码评审发现的 1 项 critical 与 3 项 high ——
①`TRUST_GATEWAY_HEADERS` 启动 fail-fast 与运行时判定统一口径（TCP 暴露 + 信任网关头 → 直接拒绝启动）；
②登录限流取客户端 IP 改用 `x-real-ip`/XFF 最右一跳（不再信任可伪造的最左值）；
③JWT 的 env 改为显式传参（消除模块级共享状态在并发下的交叉污染）；
④refresh 轮换改为「先建新会话、成功后再消费旧令牌」，失败不丢会话。另清理 EdgeOne 残留脚本/关键词。

**v1.1.2**：修复复审提出的 critical 与 high ——
①启动守卫改用与网关解析**同一个合并 env**（含 `app.env`），堵住「只往 app.env 写 TRUST_GATEWAY_HEADERS=1 即可绕过」的提权路径；
②`refresh` 末尾吊销旧会话失败不再抛 500（轮换标记已担保一次性，删失败可容忍），避免用户被锁出；
③登录限流新增 `TRUST_PROXY_HEADERS` 开关：**默认 false 用 TCP 真实对端地址**（伪造 XFF/x-real-ip 无效），仅在反代之后设为 true；
④`getConfig` 改深合并（provider 子对象不再整块覆盖默认值）、敏感字段可显式清空、GitLab 分支名 URL 编码、
代理认证头不再泄漏进 CONNECT 隧道、SQLite 事务内不再做异步加密（持锁降到微秒级）、
`toRequest` 过滤 hop-by-hop 头、`kvList` 前缀剥离修正、失败记录与轮换标记加 TTL。

**彻底移除 Edge 支持**：`edge-functions/` 业务层迁移为 `server/lib/` + `server/api/`（Node 单一入口），
删除 EdgeOne KV 默认驱动（未注入 SQLite 驱动时 fail-closed 报错）、Edge 运行时能力位分支、
JWT 的模块级 env 兜底，以及全部 Edge 专属测试与部署配置；包内不再保留任何 Edge/EdgeOne 代码路径。

---

## 快速开始（Docker）

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
docker build -t repo-watcher:1.1.2 .
docker run -d --name repo-watcher -p 8080:8080 \
  -v "$PWD/data:/app/data" \
  -e TRUST_GATEWAY_HEADERS=0 \
  -e TRUST_PROXY_HEADERS=false \
  --restart unless-stopped repo-watcher:1.1.2
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
npm test         # 跑存储/鉴权/服务/代理测试
```

`server/` 为 Node 后端（`node:sqlite`，需 Node 22+），其中：
- `server/index.js` HTTP 服务入口（Socket/TCP 双模式）
- `server/router.js` 路由分派、`server/scheduler.js` 定时检测、`server/storage/sqlite.js` 存储驱动
- `server/lib/` 业务基础库（config / auth / services / utils）
- `server/api/` 各 API 端点处理函数

`src/` 为 Vue 3 前端。**本项目只支持 Node/Docker 运行时**，不再包含 Edge/EdgeOne 相关代码。

---

## 许可证

[MIT License](./LICENSE) —— 原项目版权归原作者 **MagicCode**，
本 Docker 版衍生作品的修改部分版权归本仓库维护者。再分发请保留 `LICENSE` 与 `NOTICE`。