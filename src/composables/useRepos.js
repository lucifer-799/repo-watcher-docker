import { ref } from 'vue'
import { toUserMessage, logError } from '../utils/error.js'
import { useAdminAuth } from './useAdminAuth.js'

// 复用鉴权请求：自动注入 Authorization 头，401 时静默用 refresh 续期
const { authFetch, isLoggedIn, mode } = useAdminAuth()

// 共享单例状态：侧边菜单与仪表盘共用同一份数据，避免重复拉取与多套定时器
const data = ref(null)
const loading = ref(false)
const error = ref(null)
// 服务端最后一次执行检测的时间（来自 data.lastCheckedAt），而非浏览器拉取时间
const lastCheckedAt = ref('')

let timer = null
let started = false

async function loadData() {
  // 1.0.1：仪表盘对未登录用户开放——/api/repos 已允许匿名只读（不含任何凭据），
  // 故未登录也照常拉取；仅写/管理操作才要求登录。
  loading.value = true
  error.value = null
  try {
    const response = await authFetch('/api/repos')

    if (response.status !== 200) {
      const result = await response.json().catch(() => ({}))
      throw new Error(result.message || `请求失败 (${response.status})`)
    }

    const result = await response.json()
    data.value = result.data
    lastCheckedAt.value = result.data?.lastCheckedAt || ''
  } catch (err) {
    // 技术细节仅输出到控制台供开发者排查，页面只展示友好提示
    logError('加载数据失败', err)
    error.value = toUserMessage(err)
  } finally {
    loading.value = false
  }
}

// 启动自动刷新（幂等：全局只启动一次定时器）
function startAutoRefresh() {
  if (started) return
  started = true
  loadData()
  timer = setInterval(loadData, 30000)
}

function stopAutoRefresh() {
  if (timer) clearInterval(timer)
  timer = null
  started = false
}

export function useRepos() {
  return { data, loading, error, lastCheckedAt, loadData, startAutoRefresh, stopAutoRefresh }
}
