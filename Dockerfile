# syntax=docker/dockerfile:1
#
# repo-watcher docker 版（v1.1.1）
# 源自上游 Repo Watcher（原作者 MagicCode，MIT）：由 fpk 进程型改造为 TCP 容器，路径 env 化。
# 来源与修改说明见 NOTICE，许可条款见 LICENSE（再分发请保留）。
# 无原生模块（SQLite 用 Node 内置 node:sqlite），故 slim 足够，无需 alpine/编译链。
FROM node:22-slim

WORKDIR /app

# 依赖层单独缓存（package*.json 未变则不重装）
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# 源码 + 前端构建（vite 需要 devDependencies，故 build 前不能 --omit=dev）
COPY . .
RUN npm run build \
 && mkdir -p /app/www /app/data \
 && cp -r dist/. /app/www/ \
 && npm prune --omit=dev

# 非 root 运行：node:22-slim 内置 node 用户(uid=1000)。
# 构建产物、应用目录与 SQLite 数据目录均需归属 node，否则运行期无法写库/日志。
# 注意：compose 挂载宿主 ./data 会覆盖容器内该目录的属主，
#       部署时需在宿主执行 chown -R 1000:1000 ./data（见交付说明）。
RUN chown -R node:node /app

ENV NODE_ENV=production \
    TZ=Asia/Shanghai \
    PORT=8080 \
    HOST=0.0.0.0 \
    DB_PATH=/app/data/repo-watcher.db \
    WWW_DIR=/app/www \
    SOCKET_PATH=/app/data/app.sock \
    TRUST_GATEWAY_HEADERS=0

EXPOSE 8080

# 数据卷：SQLite 落 /app/data
VOLUME ["/app/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

USER node

CMD ["node", "server/index.js"]