import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import { viteSingleFile } from 'vite-plugin-singlefile'
import { VitePWA } from 'vite-plugin-pwa'

// base: '/' 必须使用绝对路径。原因：使用 vue-router（createWebHistory）后
// /、/admin、/admin/console 等页面由前端路由接管，靠 history 模式区分。若用相对路径 './'，
// 在 /admin/console 深层路径下资源会被解析成 /admin/assets/... 而 404，导致 JS 不执行、页面空白。
// 用 '/' 后资源恒为 /assets/...，任何路径层级都能正确加载（配合单文件内联后无此问题）。
// vite-plugin-singlefile：将 HTML/CSS/JS 全部内联进单个 dist/index.html。
// 原因：EdgeOne Makers full-stack 模式的静态托管不服务 Vite 默认的 dist/assets/ 子目录 hash 结构
//（所有 /assets/* 请求都会被 SPA fallback 成 index.html，导致 MIME 类型不匹配、页面空白）。
// 单文件自包含后，线上只有 / 返回该 HTML，/api/* 交给 edge-functions，不再有静态资源请求。
// base: 固定 '/'（Docker/反代部署，挂在域名根路径或由反代改写）。
// 不再支持带路径前缀（/app/xxx/）的构建，Docker 版固定根路径。
const BASE_PATH = '/'

/**
 * vite-plugin-singlefile 会在其 config hook 里强制把 base 改写为 './'
 * （见 node_modules/vite-plugin-singlefile/dist/esm/index.js:35），
 * 目的是让 public/ 下的静态文件用相对路径引用。
 *
 * 但相对路径在 SPA 深路由下会错位：页面位于 /app/repowatcher/admin/console 时，
 * './favicon.svg' 会被解析成 /app/repowatcher/admin/favicon.svg 而 404。
 * 改用绝对路径前缀后，任意深度都能正确解析，且 import.meta.env.BASE_URL
 * 才会带上网关前缀供前端拼接 API 路径。
 *
 * 插件的 config hook 按 pre → normal → post 顺序执行，故这里用 enforce:'post' 覆盖。
 */
function basePathPlugin(base) {
  return {
    name: 'repo-watcher-base-path',
    enforce: 'post',
    config: () => ({ base }),
  }
}

export default defineConfig({
  plugins: [
    vue(),
    tailwindcss(),
    viteSingleFile(),
    basePathPlugin(BASE_PATH),
    VitePWA({
      // 自动注册 SW 并在有新版本时静默更新（无需用户手动刷新）
      registerType: 'autoUpdate',
      // 由插件自动注入注册脚本，无需在代码里手写 registration
      injectRegister: 'auto',
      // 单文件构建下，public 内的图标被 Workbox 当作静态资源预缓存；
      // index.html 内联了全部 JS/CSS，本身就是“应用外壳”。
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest}'],
        // SPA 深链接离线回退到外壳（索引页），路由由前端接管
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
      },
      manifest: {
        name: '仓库检测仪表盘 · Repo Watcher',
        short_name: 'Repo Watcher',
        description:
          '基于 EdgeOne Makers 边缘函数的多平台仓库更新监控工具，支持 GitHub、Gitee、GitLab、GitCode 与 CNB 的代码提交检测、定时巡检与消息推送。',
        lang: 'zh-CN',
        dir: 'ltr',
        start_url: '.',
        scope: '.',
        display: 'standalone',
        display_override: ['standalone', 'minimal-ui'],
        orientation: 'portrait-primary',
        background_color: '#020617',
        theme_color: '#2563eb',
        categories: ['developer', 'productivity', 'utilities'],
        icons: [
          { src: 'favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          { src: 'favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
          { src: 'favicon_128.png', sizes: '128x128', type: 'image/png', purpose: 'any' },
          { src: 'favicon_192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'favicon_256.png', sizes: '256x256', type: 'image/png', purpose: 'any' },
          { src: 'favicon_512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
    }),
  ],
  server: {
    host: '0.0.0.0',
    allowedHosts: true
  },
  build: {
    outDir: 'dist',
    assetsInlineLimit: 100000000,
    cssCodeSplit: false,
    chunkSizeWarningLimit: 100000000,
  },
})
