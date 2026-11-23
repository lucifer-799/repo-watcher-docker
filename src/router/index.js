import { createRouter, createWebHistory } from 'vue-router'
// Docker 版固定根路径 '/'：import.meta.env.BASE_URL 为 '/'。
import Dashboard from '../views/Dashboard.vue'
import AdminInit from '../views/AdminInit.vue'
import AdminLogin from '../views/AdminLogin.vue'
import AdminConsole from '../views/AdminConsole.vue'
import { useAdminAuth } from '../composables/useAdminAuth.js'

const routes = [
  // 1.0.1：仪表盘对未登录用户开放（只读），不再要求登录
  { path: '/', name: 'dashboard', component: Dashboard },
  // /admin 只是后台入口，本身无页面：由守卫按登录状态分流到登录页或控制台
  // （未登录时的兜底重定向，已登录由 beforeEach 覆盖）
  { path: '/admin', name: 'admin', redirect: { name: 'admin-login' }, meta: { guestOnly: true } },
  { path: '/admin/login', name: 'admin-login', component: AdminLogin, meta: { guestOnly: true } },
  { path: '/admin/init', name: 'admin-init', component: AdminInit },
  // /admin/console 本身只是入口（无独立页面），分流到默认选项卡
  { path: '/admin/console', redirect: { name: 'admin-console', params: { tab: 'github' } } },
  // :tab 对应控制台内各配置区块（GitHub / Gitee / GitLab / CNB / 通知 / 其他 / 定时检测 / 账户安全）
  { path: '/admin/console/:tab', name: 'admin-console', component: AdminConsole, meta: { requiresAuth: true } },
]

export const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
  scrollBehavior() {
    return { top: 0 }
  },
})

// 后台是否已初始化，进入 /admin 区域时惰性拉取一次并缓存
let initChecked = false
let initialized = false

/**
 * 标记后台已完成初始化（初始化向导提交成功后调用）。
 * 否则守卫里的缓存仍认为未初始化，会把下一条导航打回向导页。
 */
export function markInitialized() {
  initialized = true
  initChecked = true
}

router.beforeEach(async (to) => {
  const { apiUrl, isLoggedIn, ensureSession } = useAdminAuth()
  // 1.0.1：仪表盘已对匿名开放，管理区判定不含首页
  const inAdminArea = to.path === '/admin' || to.path.startsWith('/admin/')

  // 先探测认证模式：可信网关部署下管理员免密，若不做这一步会被下面的分支打回登录页
  if (inAdminArea && !initChecked) {
    await ensureSession()
  }

  if (inAdminArea && !initChecked) {
    try {
      const res = await fetch(apiUrl('/api/admin/init'))
      const data = await res.json()
      initialized = res.ok ? !!data.data?.initialized : false
    } catch {
      initialized = false
    }
    initChecked = true
  }

  // 未初始化：管理区只允许进入初始化向导
  // 注意：strict 默认 false，/admin/ 同样命中 /admin 记录
  if (inAdminArea && !initialized && to.name !== 'admin-init') {
    return { name: 'admin-init' }
  }

  // 已初始化：向导页不应再访问
  if (to.name === 'admin-init' && initialized) {
    return { name: isLoggedIn.value ? 'admin-console' : 'admin-login' }
  }

  // 已登录时不再停留在登录页（含 /admin/ 这类入口），直接进入控制台
  if (to.meta.guestOnly && isLoggedIn.value) {
    return { name: 'admin-console' }
  }

  // 受保护路由：未登录则去登录页
  if (to.meta.requiresAuth && !isLoggedIn.value) {
    return { name: 'admin-login' }
  }

  return true
})

export default router
