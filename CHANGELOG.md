# Changelog

本项目的所有重要变更都记录在此文件中。

格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本（SemVer）](https://semver.org/lang/zh-CN/)。

本项目是 **Repo Watcher**（原作者 MagicCode，MIT 许可）的 Docker 版衍生作品，
来源与修改说明见 [NOTICE](./NOTICE)，许可条款见 [LICENSE](./LICENSE)。

## [1.1.3] - 2026-11-23

### Added
- `compose.yaml` 改为面向外部用户的公网部署模板：镜像指向
  `ghcr.io/lucifer-799/repo-watcher-docker`，版本可用 `REPO_WATCHER_VERSION` 覆盖
  （默认固定版本，也可设为 `latest`）；含数据卷、端口、环境变量、健康检查与中文注释。
- 新增 GitHub Actions 工作流 `.github/workflows/build.yml`：推送到 main、推送 `v*` 标签
  或手动触发时，自动构建并推送镜像到 ghcr.io（由 `GITHUB_TOKEN` 登录，
  标签由 metadata-action 派生：分支名、语义化版本、latest）。

### Changed
- 前端与文档中的「本项目」链接统一指向
  <https://github.com/lucifer-799/repo-watcher-docker>（原为占位地址）；
  上游原作者链接（MagicCode / 原仓库）保持不动。

### Fixed
- 无。

## [1.1.2] - 2026-11-23

### Security
- 启动守卫改为检查**合并后的运行时 env**（含安装期生成的 `app.env`），
  修复「只把 `TRUST_GATEWAY_HEADERS=1` 写入 `app.env` 即可绕过守卫、
  而网关解析仍信任伪造身份头」的提权路径。
- 登录限流新增受信代理开关 `TRUST_PROXY_HEADERS`（默认关闭）：默认按 TCP 连接的真实对端地址分桶，
  客户端伪造 `X-Forwarded-For` / `X-Real-IP` 无法绕过失败锁定；仅在部署于可信反向代理之后时才开启。

### Fixed
- `refresh` 吊销旧会话失败时不再返回 500（轮换标记已担保一次性、新会话已保存），避免用户被锁出。
- 配置读取由顶层浅合并改为**深合并**，避免旧数据中的分组对象整块覆盖新版本默认值。
- 敏感字段支持**显式清空**（区分「未提供」与「显式传空」）。
- GitLab 分支名做 URL 编码，修复含 `/` 的分支请求错误资源。
- HTTP 客户端：代理认证头不再带入 CONNECT 隧道的目标请求（防泄漏），隧道内显式补齐正确的 `Host`。
- SQLite 事务内不再执行异步操作（加密移到事务外），写入持锁时间降到微秒级。
- 转发请求时过滤 hop-by-hop 头（`Connection` / `Keep-Alive` / `TE` / `Trailer` /
  `Transfer-Encoding` / `Upgrade` / `Proxy-*` 及 `Connection` 中点名的头）。
- 修复 KV 前缀剥离逻辑（不匹配前缀的键不再原样返回，避免重复拼前缀导致无法删除）。
- 登录失败记录与 refresh 轮换标记增加 TTL，过期自动清理，避免长期累积。
- 新增 `GET /api/health`（返回 `status` / `uptime` / `version`），镜像 `HEALTHCHECK` 可正常判定健康状态。

### Removed
- **彻底移除 Edge / EdgeOne / Cloudflare 相关代码**：业务层由 `edge-functions/` 并入
  `server/lib/` + `server/api/`（单一 Node 入口）；删除 EdgeOne KV 默认驱动（未注入 SQLite
  驱动时直接报错，fail-closed）、Edge 能力位分支、JWT 的模块级 env 兜底，以及全部 Edge 专属测试与配置。
- 仓库按白名单收紧，仅保留 Docker 构建/运行所需内容。

### Changed
- 测试统一归入 `test/`，并新增安全回归套件（令牌类型、启动 fail-fast、匿名只读边界、
  写端点鉴权、初始化并发、登录限流、refresh 轮换、模板原型污染、健康检查、非 root 运行）。

## [1.1.1] - 2026-11-23

### Security
- `TRUST_GATEWAY_HEADERS` 增加**启动 fail-fast**：当同时以 `PORT` 对外监听且该值为真时拒绝启动，
  防止暴露 TCP 后伪造网关身份头提权；新增 `isTruthy()` 统一真值判定口径。

### Fixed
- 登录失败限流不再取 `X-Forwarded-For` 最左值（客户端可伪造），改为可信来源取值。
- JWT 签名的 env 改为参数显式传入，消除模块级共享状态在并发下的交叉污染。
- refresh 轮换改为「先签发并保存新会话、成功后再消费旧令牌」，失败不丢会话。

### Removed
- 移除残留的平台专用构建脚本与关键词（如 EdgeOne 相关 script / keywords）。

## [1.1.0] - 2026-11-23

### Added
- 重写 `README.md`：顶部标明来源（原作者、上游地址、MIT 许可）与二次开发声明，
  并补充 Docker 部署、环境变量、数据卷、使用说明。
- 新增 `NOTICE`（来源与修改清单）与 `.env.example`。

### Removed
- 删除 fpk / 飞牛、CNB / EdgeOne 平台残留：`fnos/`、`.cnb/`、`.cnb.yml`、`edgeone.json`、
  `skills-lock.json`、平台专用构建脚本与测试等。

### Changed
- 内部环境地址与流水线配置清理为占位示例（不含任何内部地址或凭据）。
- Git 历史以 orphan 分支重新开启，移除历史中的内部环境痕迹（旧历史以 archive 标签保留）。

## [1.0.2] - 2026-11-23

### Security
- 修复 JWT 令牌类型混用：`refresh` token 不能再当作 `access` token 使用。
- 修复通知模板渲染的原型污染（拒绝 `__proto__` / `constructor` / `prototype` 路径）。
- 修复管理员初始化 TOCTOU 竞态：改为原子 CAS 写入，并发初始化不会被覆盖。
- 容器以非 root 运行（`USER node`）。
- refresh token 改为一次性轮换。
- 配置更新改为事务内读改写，防止并发丢更新。
- 登录失败限流（失败计数 + 指数退避）。
- `/api/check` 在未配置访问令牌时由 500 改为 401（fail-closed 语义不变），并使用定长比较。
- 匿名请求不再返回 `lastCheckError`（可能含内部错误细节）。
- PBKDF2 迭代次数提升至 60 万，哈希格式升级为自带迭代次数；
  旧哈希仍按原迭代数验证（老密码照常可用），改密后自动升级。

### Fixed
- 修复多值 `Set-Cookie` 响应头被折叠的问题。
- 修复服务监听错误未捕获、强制退出定时器未清理等问题。
- 修复配置读取与加密密钥处理的若干边界问题（含 `crypto` 密钥派生返回类型统一）。
- 修复多值响应头、监听错误、强制退出定时器等运行时健壮性问题。

## [1.0.1] - 2026-11-23

### Added
- **未登录可只读查看仪表盘**：展示已配置的仓库列表、监控状态与统计；
  隐藏管理后台菜单与所有编辑入口；后端只读接口允许匿名访问（响应不含任何凭据），
  写/管理接口未登录仍返回 401。

### Changed
- 侧边栏管理入口文案调整。

## [1.0.0] - 2026-11-23

### Added
- Docker 化重构初始版本：由 fpk / 飞牛应用形态重构为 Docker 容器
  （`node:22-slim` + 内置 `node:sqlite`，无需原生模块编译）。
- 监听方式由 Unix Socket 改为 TCP（`PORT` 环境变量），便于反向代理与容器编排。
- 数据持久化（`/app/data` 卷，SQLite 单库）与镜像 `HEALTHCHECK`。
- 提供 `compose.yaml` 与可配置的宿主端口、环境变量（`HOST` / `DB_PATH` / `WWW_DIR` 等）。
- 前端构建产物由镜像内 `npm run build` 生成（Vite + 单文件打包 + PWA）。

[1.1.3]: #113---2026-11-23
[1.1.2]: #112---2026-11-23
[1.1.1]: #111---2026-11-23
[1.1.0]: #110---2026-11-23
[1.0.2]: #102---2026-11-23
[1.0.1]: #101---2026-11-23
[1.0.0]: #100---2026-11-23

---

更多信息：

- Keep a Changelog：<https://keepachangelog.com/zh-CN/1.1.0/>
- 语义化版本 SemVer：<https://semver.org/lang/zh-CN/>
- 本项目许可证（MIT）：[LICENSE](./LICENSE)