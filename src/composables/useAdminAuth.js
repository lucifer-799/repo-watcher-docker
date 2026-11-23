import { ref, computed } from 'vue'
import router from '../router'

/**
 * 管理后台鉴权组合式函数
 * - access / refresh token 存储于 sessionStorage
 * - 受保护请求自动注入 Authorization 头
 * - 401 时自动用 refresh 续期，失败则跳登录
 */

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || ''

// 构建期注入的 base（Vite BASE_URL）。
// Docker 版固定 '/'（如用反向代理挂在子路径，请配置代理改写）。
// 用于把 API 路径拼到正确前缀下，避免硬编码 '/api/...' 在网关前缀下 404。
const BASE = import.meta.env.BASE_URL || '/'

const ACCESS_KEY = 'rw_access_token'
const REFRESH_KEY = 'rw_refresh_token'

/**
 * 把 base 与 path 拼接，避免双斜杠。
 * base='/app/repowatcher/' + path='/api/admin/config' -> '/app/repowatcher/api/admin/config'
 * base='/'                 + path='/api/admin/config' -> '/api/admin/config'
 */
function joinUrl(base, path) {
  if (!base || base === '/') return path
  return `${base.replace(/\/+$/, '')}/${String(path).replace(/^\/+/, '')}`
}

const accessToken = ref(sessionStorage.getItem(ACCESS_KEY) || '')
const refreshToken = ref(sessionStorage.getItem(REFRESH_KEY) || '')
const username = ref('')

// 认证模式：'gateway' 表示由可信前置网关注入管理员身份（免密，仅 Socket 模式适用），'password' 为本地账号密码。
// 网关模式下无本地 token，isLoggedIn 直接由 mode 决定。
const mode = ref('password')
// 网关模式下隐藏改密/登出入口（凭据与会话均由 NAS 管理）
const canChangePassword = ref(true)
const canLogout = ref(true)
let sessionChecked = false

function persist() {
  if (accessToken.value) sessionStorage.setItem(ACCESS_KEY, accessToken.value)
  else sessionStorage.removeItem(ACCESS_KEY)
  if (refreshToken.value) sessionStorage.setItem(REFRESH_KEY, refreshToken.value)
  else sessionStorage.removeItem(REFRESH_KEY)
}

function setTokens(access, refresh, user) {
  accessToken.value = access
  refreshToken.value = refresh
  username.value = user || ''
  persist()
}

function clearTokens() {
  accessToken.value = ''
  refreshToken.value = ''
  username.value = ''
  persist()
}

// 网关模式下由 NAS 会话保证身份，恒为已登录
const isLoggedIn = computed(() => (mode.value === 'gateway' ? true : !!accessToken.value))

function apiUrl(path) {
  return API_BASE_URL ? `${API_BASE_URL}${path}` : joinUrl(BASE, path)
}

/**
 * 探测当前认证模式（惰性，仅执行一次）。
 * 可信网关部署下后端返回 mode='gateway'，前端据此免密进入控制台。
 * 失败时安全回落为 password 模式，不影响原有登录流程。
 */
async function ensureSession() {
  if (sessionChecked) return
  sessionChecked = true
  try {
    const res = await fetch(apiUrl('/api/admin/session'))
    if (!res.ok) return
    const json = await res.json()
    const d = json?.data || {}
    if (d.mode === 'gateway' && d.authenticated) {
      mode.value = 'gateway'
      username.value = d.username || ''
      canChangePassword.value = d.canChangePassword === true
      canLogout.value = d.canLogout === true
      // 网关模式下不保留本地 token，避免两套凭据并存
      clearTokens()
    }
  } catch {
    // 后端不可达或接口不存在时保持 password 模式
  }
}

/**
 * 发起受保护请求，自动处理 401 续期
 */
async function authFetch(path, options = {}) {
  options.headers = options.headers || {}

  // 网关模式下身份由网关注入的 X-Trim-* 头携带，无需也不应附加本地 token
  if (mode.value !== 'gateway' && accessToken.value) {
    options.headers['Authorization'] = `Bearer ${accessToken.value}`
  }

  let res = await fetch(apiUrl(path), options)

  // 网关模式无 refresh 流程，401 直接判定为无权访问
  if (mode.value === 'gateway') {
    if (res.status === 401) throw new Error('当前 NAS 账号无权访问，请联系管理员')
    return res
  }

  if (res.status === 401 && refreshToken.value) {
    // 尝试 refresh
    const refreshed = await tryRefresh()
    if (refreshed) {
      if (accessToken.value) options.headers['Authorization'] = `Bearer ${accessToken.value}`
      res = await fetch(apiUrl(path), options)
    }
  }

  if (res.status === 401) {
    clearTokens()
    if (router.currentRoute.value.path.startsWith('/admin')) {
      router.push('/admin/login')
    }
    throw new Error('未登录或会话已失效')
  }

  return res
}

async function tryRefresh() {
  try {
    const res = await fetch(apiUrl('/api/admin/refresh'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${refreshToken.value}` }
    })
    if (!res.ok) return false
    const data = await res.json()
    accessToken.value = data.data.accessToken
    // 1.0.2：服务端 refresh token 改为一次性轮换，必须同步保存新值，
    // 否则下次刷新会因旧令牌被消费而 401（表现为被踢回登录页）
    if (data.data && data.data.refreshToken) refreshToken.value = data.data.refreshToken
    persist()
    return true
  } catch {
    return false
  }
}

async function login(user, pass) {
  const res = await fetch(apiUrl('/api/admin/login'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: user, password: pass })
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.message || '登录失败')
  setTokens(data.data.accessToken, data.data.refreshToken, data.data.username)
  return data
}

async function logout() {
  try {
    await authFetch('/api/admin/logout', { method: 'POST' })
  } catch { /* ignore */ }
  clearTokens()
}

export function useAdminAuth() {
  return {
    accessToken, refreshToken, username, isLoggedIn,
    mode, canChangePassword, canLogout, ensureSession,
    setTokens, clearTokens, authFetch, login, logout, apiUrl
  }
}
