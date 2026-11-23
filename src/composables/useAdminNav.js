import { reactive, computed } from 'vue'
import { useAdminAuth } from './useAdminAuth.js'

// 管理后台各配置区块（原 AdminConsole 内的选项卡），抽离为共享定义，
// 供左侧菜单二级导航与控制台页面共同使用，避免两处重复维护。
const tabs = [
  { key: 'github', label: 'GitHub' },
  { key: 'gitee', label: 'Gitee' },
  { key: 'gitlab', label: 'GitLab' },
  { key: 'gitcode', label: 'GitCode' },
  { key: 'cnb', label: 'CNB' },
  { key: 'notify', label: '通知' },
  { key: 'other', label: '其他' },
  // 内置定时检测依赖常驻进程，无守宿进程的运行时不展示
  { key: 'scheduler', label: '定时检测', feature: 'scheduler' },
  { key: 'security', label: '账户安全', feature: 'changePassword' },
]

// 后端能力位：scheduler 仅在自托管常驻进程中可用（无常驻进程时为 false，不展示该选项卡）
const capabilities = reactive({ runtime: 'edge', scheduler: false })
let capsLoaded = false

export function useAdminNav() {
  const { canChangePassword, authFetch } = useAdminAuth()

  // 按能力位过滤：无常驻进程不展示定时检测；网关登录模式不展示账户安全
  const visibleTabs = computed(() =>
    tabs.filter((t) => {
      if (t.feature === 'scheduler') return capabilities.scheduler === true
      if (t.feature === 'changePassword') return canChangePassword.value
      return true
    })
  )

  function isTabKey(key) {
    return tabs.some((t) => t.key === key)
  }

  // 拉取后端能力位（如 scheduler 是否可用），写入共享响应式对象。
  // 仅执行一次，失败（未登录 / 接口不可达）时忽略，回落默认（隐藏定时检测）。
  let capsLoading = false
  async function loadCapabilities() {
    // 1.0.2：只在「真正成功」后置 capsLoaded，且用 loading 标志防并发重复请求。
    // 原实现进函数就置 true，一旦首次失败（未登录 401 / 网络抖动）后续永不重试，
    // 导致二级菜单能力位一直是默认值（定时检测项永远不出现）。
    if (capsLoaded || capsLoading) return
    capsLoading = true
    try {
      const res = await authFetch('/api/admin/config')
      if (!res.ok) return
      const data = await res.json()
      if (data?.capabilities) {
        capabilities.runtime = data.capabilities.runtime || 'edge'
        capabilities.scheduler = data.capabilities.scheduler === true
      }
      capsLoaded = true
    } catch {
      /* 失败不置位：下次进入后台会重试 */
    } finally {
      capsLoading = false
    }
  }

  return { tabs, visibleTabs, capabilities, isTabKey, loadCapabilities }
}
