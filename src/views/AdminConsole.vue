<template>
  <div class="min-h-dvh max-w-4xl mx-auto pt-4 sm:pt-8 px-safe-area">
    <!-- 顶部操作栏 -->
    <header class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6 sm:mb-8">
      <div class="flex items-center gap-3 min-w-0">
        <h1 class="text-lg sm:text-xl font-semibold text-slate-900 dark:text-white tracking-tight shrink-0">配置后台</h1>
        <!-- 网关登录模式：提示身份来源，明确凭据由前置网关管理 -->
        <span v-if="mode === 'gateway'"
          class="text-[10px] sm:text-xs px-1.5 sm:px-2 py-0.5 rounded-full bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400 whitespace-nowrap">
          网关登录
        </span>
      </div>
      <div class="admin-toolbar">
        <button @click="save" :disabled="saving" class="admin-btn admin-btn--success">
          {{ saving ? '保存中...' : '保存配置' }}
        </button>
        <!-- 网关模式下会话由 NAS 管理，应用内退出无意义，故隐藏 -->
        <button v-if="canLogout" @click="doLogout" class="admin-btn admin-btn--secondary">
          退出
        </button>
        <RouterLink to="/" class="admin-btn admin-btn--ghost sm:!hidden">
          返回首页
        </RouterLink>
      </div>
    </header>

    <!-- 右下角弹出通知 -->
    <div class="fixed right-3 sm:right-4 left-3 sm:left-auto z-50 flex flex-col gap-2 items-stretch sm:items-end pointer-events-none toast-container">
      <transition-group name="toast">
        <div v-for="t in toasts" :key="t.id"
          class="pointer-events-auto rounded-xl px-4 py-3 shadow-lg text-sm max-w-none sm:max-w-xs w-full sm:w-auto flex items-start gap-2.5"
          :class="t.type === 'error'
            ? 'bg-white dark:bg-slate-800 border border-red-200 dark:border-red-500/30 text-red-600 dark:text-red-400'
            : 'bg-white dark:bg-slate-800 border border-emerald-200 dark:border-emerald-500/30 text-emerald-600 dark:text-emerald-400'">
          <svg v-if="t.type !== 'error'" class="w-4 h-4 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path>
          </svg>
          <svg v-else class="w-4 h-4 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
          </svg>
          <span class="break-words">{{ t.text }}</span>
        </div>
      </transition-group>
    </div>

    <ConfigSection title="GitHub" icon="github" v-if="activeTab === 'github'">
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div class="md:col-span-2">
          <RepoListEditor v-model="cfg.github.repos" platform="github" :default-branch="cfg.github.branch" :checking-keys="checkingKeys" @check="(row) => onCheckRepo('github', row)" />
        </div>
        <div>
          <label class="form-label">默认分支（行内为空时使用）</label>
          <input v-model="cfg.github.branch" class="form-input" />
        </div>
        <div class="md:col-span-2">
          <TokenField v-model="cfg.github.token" label="Token" :configured="secrets.github.token" />
        </div>
        <div class="md:col-span-2">
          <label class="form-label">HTTP 代理（可选）</label>
          <input v-model="cfg.github.proxy" class="form-input" placeholder="http://127.0.0.1:7890（留空不使用代理）" />
          <p class="text-xs text-slate-400 dark:text-slate-500 mt-1.5">如国内访问 GitHub 不佳，可在此填入 HTTP 代理地址，仅对该平台生效。</p>
        </div>
      </div>
    </ConfigSection>

    <ConfigSection title="Gitee" icon="gitee" v-if="activeTab === 'gitee'">
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div class="md:col-span-2">
          <RepoListEditor v-model="cfg.gitee.repos" platform="gitee" :default-branch="cfg.gitee.branch" :checking-keys="checkingKeys" @check="(row) => onCheckRepo('gitee', row)" />
        </div>
        <div>
          <label class="form-label">默认分支（行内为空时使用）</label>
          <input v-model="cfg.gitee.branch" class="form-input" />
        </div>
        <div class="md:col-span-2">
          <TokenField v-model="cfg.gitee.token" label="Token" :configured="secrets.gitee.token" />
        </div>
        <div class="md:col-span-2">
          <label class="form-label">HTTP 代理（可选）</label>
          <input v-model="cfg.gitee.proxy" class="form-input" placeholder="http://127.0.0.1:7890（留空不使用代理）" />
          <p class="text-xs text-slate-400 dark:text-slate-500 mt-1.5">仅对该平台生效，留空则直连。</p>
        </div>
      </div>
    </ConfigSection>

    <ConfigSection title="GitLab" icon="gitlab" v-if="activeTab === 'gitlab'">
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div class="md:col-span-2">
          <RepoListEditor v-model="cfg.gitlab.repos" platform="gitlab" :default-branch="cfg.gitlab.branch" :checking-keys="checkingKeys" @check="(row) => onCheckRepo('gitlab', row)" />
        </div>
        <div>
          <label class="form-label">默认分支（行内为空时使用）</label>
          <input v-model="cfg.gitlab.branch" class="form-input" />
        </div>
        <div>
          <label class="form-label">API Base</label>
          <input v-model="cfg.gitlab.apiBase" class="form-input" />
        </div>
        <div>
          <label class="form-label">Host</label>
          <input v-model="cfg.gitlab.host" class="form-input" />
        </div>
        <div class="md:col-span-2">
          <TokenField v-model="cfg.gitlab.token" label="Token" :configured="secrets.gitlab.token" />
        </div>
        <div class="md:col-span-2">
          <label class="form-label">HTTP 代理（可选）</label>
          <input v-model="cfg.gitlab.proxy" class="form-input" placeholder="http://127.0.0.1:7890（留空不使用代理）" />
          <p class="text-xs text-slate-400 dark:text-slate-500 mt-1.5">仅对该平台生效，留空则直连。</p>
        </div>
      </div>
    </ConfigSection>

    <ConfigSection title="GitCode" icon="gitcode" v-if="activeTab === 'gitcode'">
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div class="md:col-span-2">
          <RepoListEditor v-model="cfg.gitcode.repos" platform="gitcode" :default-branch="cfg.gitcode.branch" :checking-keys="checkingKeys" @check="(row) => onCheckRepo('gitcode', row)" />
        </div>
        <div>
          <label class="form-label">默认分支（行内为空时使用）</label>
          <input v-model="cfg.gitcode.branch" class="form-input" />
        </div>
        <div>
          <label class="form-label">API Base</label>
          <input v-model="cfg.gitcode.apiBase" class="form-input" />
        </div>
        <div>
          <label class="form-label">Host</label>
          <input v-model="cfg.gitcode.host" class="form-input" />
        </div>
        <div class="md:col-span-2">
          <TokenField v-model="cfg.gitcode.token" label="Token" :configured="secrets.gitcode.token" required />
        </div>
        <div class="md:col-span-2">
          <label class="form-label">HTTP 代理（可选）</label>
          <input v-model="cfg.gitcode.proxy" class="form-input" placeholder="http://127.0.0.1:7890（留空不使用代理）" />
          <p class="text-xs text-slate-400 dark:text-slate-500 mt-1.5">仅对该平台生效，留空则直连。</p>
        </div>
      </div>
    </ConfigSection>

    <ConfigSection title="CNB" icon="cnb" v-if="activeTab === 'cnb'">
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div class="md:col-span-2">
          <RepoListEditor v-model="cfg.cnb.repos" platform="cnb" :default-branch="cfg.cnb.branch" :checking-keys="checkingKeys" @check="(row) => onCheckRepo('cnb', row)" />
        </div>
        <div>
          <label class="form-label">默认分支（行内为空时使用）</label>
          <input v-model="cfg.cnb.branch" class="form-input" />
        </div>
        <div>
          <label class="form-label">API Base</label>
          <input v-model="cfg.cnb.apiBase" class="form-input" />
        </div>
        <div class="md:col-span-2">
          <TokenField v-model="cfg.cnb.token" label="Token" :configured="secrets.cnb.token" required />
        </div>
        <div class="md:col-span-2">
          <label class="form-label">HTTP 代理（可选）</label>
          <input v-model="cfg.cnb.proxy" class="form-input" placeholder="http://127.0.0.1:7890（留空不使用代理）" />
          <p class="text-xs text-slate-400 dark:text-slate-500 mt-1.5">仅对该平台生效，留空则直连。</p>
        </div>
      </div>
    </ConfigSection>

    <ConfigSection title="通知" icon="" v-if="activeTab === 'notify'">
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
        <label class="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300 cursor-pointer select-none">
          <input type="checkbox" v-model="cfg.notifyOnFirstCheck"
            class="w-4 h-4 rounded accent-blue-600 border-slate-300 dark:border-slate-600" />
          首次检测也发送通知
        </label>
        <button @click="testNotify" :disabled="saving || sendingNotify"
          class="admin-btn admin-btn--ghost self-start sm:self-auto">
          {{ sendingNotify ? '发送中...' : '测试通知' }}
        </button>
      </div>

      <!-- MagicPush 通知 -->
      <div class="border-t border-slate-100 dark:border-slate-800 pt-5">
        <div class="flex items-center justify-between mb-3">
          <p class="text-sm font-medium text-slate-700 dark:text-slate-300">MagicPush 通知</p>
          <label class="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300 cursor-pointer select-none">
            <input type="checkbox" v-model="cfg.magicpush.enabled"
              class="w-4 h-4 rounded accent-blue-600 border-slate-300 dark:border-slate-600" />
            启用
          </label>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-3.5 md:gap-4">
          <TokenField v-model="cfg.magicpush.url" label="URL" :configured="secrets.magicpush.url" />
          <TokenField v-model="cfg.magicpush.token" label="Token" :configured="secrets.magicpush.token" />
        </div>
      </div>

      <!-- 自定义通知 -->
      <div class="border-t border-slate-100 dark:border-slate-800 pt-5 mt-5">
        <div class="flex items-center justify-between mb-3">
          <p class="text-sm font-medium text-slate-700 dark:text-slate-300">自定义通知</p>
          <label class="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300 cursor-pointer select-none">
            <input type="checkbox" v-model="cfg.custom.enabled"
              class="w-4 h-4 rounded accent-blue-600 border-slate-300 dark:border-slate-600" />
            启用
          </label>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-3.5 md:gap-4">
          <div>
            <label class="form-label">请求 URL</label>
            <input v-model="cfg.custom.url" class="form-input" placeholder="https://example.com/webhook" />
          </div>
          <div>
            <label class="form-label">请求方法</label>
            <select v-model="cfg.custom.method" class="form-input">
              <option>POST</option>
              <option>GET</option>
              <option>PUT</option>
              <option>PATCH</option>
              <option>DELETE</option>
            </select>
          </div>
          <div class="md:col-span-2">
            <label class="form-label">请求头（JSON，支持变量）</label>
            <textarea v-model="cfg.custom.headers" rows="3"
              class="form-input font-mono text-xs leading-relaxed"
              placeholder='{"Authorization":"Bearer {{token}}"}'></textarea>
          </div>
          <div class="md:col-span-2">
            <label class="form-label">请求体（支持变量）</label>
            <textarea v-model="cfg.custom.body" rows="4"
              class="form-input font-mono text-xs leading-relaxed"
              placeholder='{"text":"{{title}}\n{{content}}"}'></textarea>
            <p class="text-xs text-slate-400 dark:text-slate-500 mt-1.5" v-pre>
              可用变量：{{repo}} {{url}} {{latestTag}} {{latestSha}} {{latestMessage}} {{branch}} {{platform}} {{releaseName}} {{releaseUrl}} {{title}} {{content}}
            </p>
          </div>
        </div>
      </div>
    </ConfigSection>

    <ConfigSection title="其他" icon="" v-if="activeTab === 'other'">
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label class="form-label">时区（如 UTC+8）</label>
          <input v-model="cfg.tz" class="form-input" />
        </div>
        <div class="md:col-span-2">
          <TokenField v-model="cfg.checkToken" label="检测令牌 CHECK_TOKEN" :configured="secrets.checkToken" />
        </div>
      </div>
    </ConfigSection>

    <ConfigSection title="定时检测" icon="" v-if="activeTab === 'scheduler'">
      <p class="text-sm text-slate-500 dark:text-slate-400 mb-4">
        由本服务内置调度器定期检测所有仓库并在有更新时发送通知，无需外部 Cron 服务。
        配置保存后最迟 60 秒生效。
      </p>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div class="md:col-span-2 flex items-center gap-3">
          <input id="sched-enabled" type="checkbox" v-model="cfg.scheduler.enabled"
            class="h-4 w-4 rounded border-slate-300 dark:border-slate-600" />
          <label for="sched-enabled" class="text-sm text-slate-700 dark:text-slate-300">
            启用定时检测
          </label>
        </div>
        <div>
          <label class="form-label">检测间隔（分钟，1 - 1440）</label>
          <input type="number" min="1" max="1440" v-model.number="cfg.scheduler.intervalMinutes"
            :disabled="!cfg.scheduler.enabled" class="form-input" />
        </div>
        <div class="md:col-span-2">
          <p class="text-xs text-slate-400 dark:text-slate-500">
            非管理员可见的仪表盘数据由 <code>/api/repos</code> 公开提供，本配置仅影响自动检测频率。
          </p>
        </div>
      </div>
    </ConfigSection>

    <ConfigSection title="账户安全" icon="" v-if="activeTab === 'security'">
      <p class="text-sm text-slate-500 dark:text-slate-400 mb-4">
        修改密码后，所有已登录设备将被强制退出，需重新登录。
      </p>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label class="form-label">原密码</label>
          <input type="password" v-model="oldPwd" autocomplete="current-password" class="form-input" />
        </div>
        <div>
          <label class="form-label">新密码（至少 6 位）</label>
          <input type="password" v-model="newPwd" autocomplete="new-password" class="form-input" />
        </div>
        <div class="md:col-span-2">
          <label class="form-label">确认新密码</label>
          <input type="password" v-model="confirmPwd" autocomplete="new-password" class="form-input" />
        </div>
        <div class="md:col-span-2">
          <button @click="changePassword" :disabled="savingPwd"
            class="btn btn-danger text-xs">
            {{ savingPwd ? '修改中...' : '修改密码' }}
          </button>
        </div>
      </div>
    </ConfigSection>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted, watch } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import ConfigSection from '../components/ConfigSection.vue'
import TokenField from '../components/TokenField.vue'
import RepoListEditor from '../components/RepoListEditor.vue'
import { useAdminAuth } from '../composables/useAdminAuth.js'
import { useAdminNav } from '../composables/useAdminNav.js'
import { toUserMessage, logError } from '../utils/error.js'
import router from '../router'

const { authFetch, apiUrl, logout, canLogout, mode } = useAdminAuth()
const { capabilities, isTabKey } = useAdminNav()

const route = useRoute()
// 选项卡状态改为由路由参数驱动（/admin/console/:tab），
// 左侧菜单二级导航切换即切换路由；表单数据由共享的 cfg 维护，切换不丢数据。
const activeTab = ref(isTabKey(route.params.tab) ? route.params.tab : 'github')

watch(
  () => route.params.tab,
  (t) => { if (isTabKey(t)) activeTab.value = t }
)

const cfg = reactive({
  github: { repos: [], branch: 'main', token: '', proxy: '' },
  gitee: { repos: [], branch: 'master', token: '', proxy: '' },
  gitlab: { repos: [], branch: 'main', token: '', apiBase: 'https://gitlab.com', host: 'gitlab.com', proxy: '' },
  gitcode: { repos: [], branch: 'main', token: '', apiBase: 'https://gitcode.com', host: 'gitcode.com', proxy: '' },
  cnb: { repos: [], branch: 'main', token: '', apiBase: 'https://api.cnb.cool', proxy: '' },
  notifyOnFirstCheck: false,
  tz: 'UTC+8',
  checkToken: '',
  magicpush: { enabled: false, url: '', token: '' },
  custom: { enabled: false, url: '', method: 'POST', headers: '', body: '' },
  scheduler: { enabled: false, intervalMinutes: 30 },
})
// 后端能力位由共享 useAdminNav() 中的 capabilities 维护（此处仅引用，不再重复声明）
const secrets = reactive({
  github: { token: false }, gitee: { token: false }, gitlab: { token: false }, gitcode: { token: false }, cnb: { token: false },
  checkToken: false, magicpush: { url: false, token: false },
  custom: { headers: false, body: false },
})

const saving = ref(false)
const sendingNotify = ref(false)

// 正在检测中的仓库键集合：platform|repo|branch，用于禁用对应行的检查按钮
const checkingKeys = reactive(new Set())

// 右下角弹出通知
let toastSeq = 0
const toasts = ref([])
function showToast(text, type = 'success', duration = 3000) {
  const id = ++toastSeq
  toasts.value.push({ id, text, type })
  setTimeout(() => {
    toasts.value = toasts.value.filter(t => t.id !== id)
  }, duration)
}

// 后台请求失败：技术细节仅记录到控制台，页面弹出友好提示
function reportError(e) {
  logError('后台请求失败', e)
  showToast(toUserMessage(e), 'error')
}

// 修改密码
const oldPwd = ref('')
const newPwd = ref('')
const confirmPwd = ref('')
const savingPwd = ref(false)

function clearEmpty(obj) {
  const out = JSON.parse(JSON.stringify(obj))
  for (const k of ['github', 'gitee', 'gitlab', 'gitcode', 'cnb']) {
    if (!out[k]) continue
    if (out[k].token === '') delete out[k].token
    if (Array.isArray(out[k].repos)) {
      out[k].repos = out[k].repos
        .filter(r => r && (r.repo || '').trim())
        .map(r => {
          const source = r.source === 'release' ? 'release' : 'commit'
          return {
            repo: r.repo.trim(),
            branch: (r.branch || '').trim(),
            note: (r.note || '').trim(),
            source,
            includePrerelease: source === 'release' && r.includePrerelease === true,
          }
        })
    }
    delete out[k].repo
  }
  if (out.checkToken === '') delete out.checkToken
  if (out.magicpush?.url === '') delete out.magicpush.url
  if (out.magicpush?.token === '') delete out.magicpush.token
  if (out.custom?.headers === '') delete out.custom.headers
  if (out.custom?.body === '') delete out.custom.body
  return out
}

// 提交前把间隔钳制到 [1, 1440]，避免脏值被后端静默纠正
function normalizeSchedulerInput() {
  const n = Number(cfg.scheduler.intervalMinutes)
  cfg.scheduler.intervalMinutes = Number.isFinite(n)
    ? Math.min(1440, Math.max(1, Math.trunc(n)))
    : 30
  cfg.scheduler.enabled = cfg.scheduler.enabled === true
}

async function load() {
  try {
    const res = await authFetch('/api/admin/config')
    const data = await res.json()
    if (!res.ok) { showToast(data.message, 'error'); return }
    mergeConfig(data.data, data.secrets, data.capabilities)
  } catch (e) {
    reportError(e)
  }
}

function mergeConfig(d, sec, caps) {
  if (!d) return
  if (caps) {
    capabilities.runtime = caps.runtime || 'edge'
    capabilities.scheduler = caps.scheduler === true
  }
  if (d.scheduler) {
    const n = Number(d.scheduler.intervalMinutes)
    cfg.scheduler.enabled = d.scheduler.enabled === true
    cfg.scheduler.intervalMinutes = Number.isFinite(n) ? n : 30
  }
  for (const k of ['github', 'gitee', 'gitlab', 'gitcode', 'cnb']) {
    if (!d[k]) continue
    Object.assign(cfg[k], d[k])
    cfg[k].repos = Array.isArray(d[k].repos) ? d[k].repos : []
  }
  if (d.magicpush) Object.assign(cfg.magicpush, d.magicpush)
  if (d.custom) Object.assign(cfg.custom, d.custom)
  cfg.notifyOnFirstCheck = !!d.notifyOnFirstCheck
  cfg.tz = d.tz || 'UTC+8'
  cfg.checkToken = d.checkToken || ''
  for (const k of ['github', 'gitee', 'gitlab', 'gitcode', 'cnb']) {
    secrets[k].token = !!(sec?.[k]?.token)
  }
  secrets.checkToken = !!(sec?.checkToken)
  secrets.magicpush.url = !!(sec?.magicpush?.url)
  secrets.magicpush.token = !!(sec?.magicpush?.token)
  secrets.custom.headers = !!(sec?.custom?.headers)
  secrets.custom.body = !!(sec?.custom?.body)
}

async function save() {
  saving.value = true
  try {
    normalizeSchedulerInput()
    const payload = clearEmpty(cfg)
    // clearEmpty 只处理既有字段，scheduler 需显式带上
    payload.scheduler = { ...cfg.scheduler }
    const res = await authFetch('/api/admin/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
    const data = await res.json()
    if (!res.ok) { showToast(data.message, 'error'); return }
    mergeConfig(data.data, data.secrets, data.capabilities)
    showToast('配置已保存', 'success')
  } catch (e) {
    reportError(e)
  } finally {
    saving.value = false
  }
}

// 单仓库手动检查：只针对传入的仓库发起检测，并反馈结果
function checkKey(platform, repo, branch) {
  return `${platform}|${repo}|${branch || ''}`
}

async function onCheckRepo(platform, row) {
  const key = checkKey(platform, row.repo, row.branch)
  if (!row.repo || checkingKeys.has(key)) return
  checkingKeys.add(key)
  try {
    const res = await authFetch('/api/admin/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ platform, repo: row.repo, branch: row.branch, notify: true }),
    })
    const data = await res.json()
    if (!res.ok) { showToast(data.message || '检测失败', 'error'); return }
    const results = data.data || []
    if (!results.length) { showToast('未返回检测结果', 'error'); return }
    const r = results[0]
    if (r.error) showToast(`${r.repo}：检测失败 ${r.error}`, 'error')
    else if (r.hasUpdate) showToast(`${r.repo}：发现更新`, 'success')
    else if (r.isFirstCheck) showToast(`${r.repo}：首次检测，已记录基线`, 'success')
    else showToast(`${r.repo}：无变化`, 'success')
  } catch (e) {
    reportError(e)
  } finally {
    checkingKeys.delete(key)
  }
}

async function testNotify() {
  if (sendingNotify.value) return
  sendingNotify.value = true
  try {
    const res = await authFetch('/api/admin/test-notify', { method: 'POST' })
    const data = await res.json()
    showToast('通知已发送：' + JSON.stringify(data.data), 'success')
  } catch (e) {
    reportError(e)
  } finally {
    sendingNotify.value = false
  }
}

async function doLogout() {
  await logout()
  router.push('/admin/login')
}

async function changePassword() {
  if (!oldPwd.value || !newPwd.value || !confirmPwd.value) {
    showToast('请填写完整', 'error')
    return
  }
  if (newPwd.value !== confirmPwd.value) {
    showToast('两次新密码不一致', 'error')
    return
  }
  if (newPwd.value.length < 6) {
    showToast('新密码至少 6 位', 'error')
    return
  }
  savingPwd.value = true
  try {
    const res = await authFetch('/api/admin/password', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ oldPassword: oldPwd.value, newPassword: newPwd.value })
    })
    const data = await res.json()
    if (!res.ok) { showToast(data.message, 'error'); return }
    showToast(data.message || '密码已修改', 'success')
    await logout()
    router.push('/admin/login')
  } catch (e) {
    reportError(e)
  } finally {
    savingPwd.value = false
  }
}

onMounted(load)
</script>

<style scoped>
/* 右下角通知弹出/消失动画 */
.toast-enter-active,
.toast-leave-active {
  transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
}
.toast-enter-from {
  opacity: 0;
  transform: translateY(8px) scale(0.98);
}
.toast-leave-to {
  opacity: 0;
  transform: translateX(8px);
}

/* 主内容安全区 padding */
.px-safe-area {
  padding-left: max(0.75rem, env(safe-area-inset-left, 0px));
  padding-right: max(0.75rem, env(safe-area-inset-right, 0px));
  padding-bottom: calc(2.5rem + env(safe-area-inset-bottom, 0px));
}
@media (min-width: 640px) {
  .px-safe-area {
    padding-left: max(1.5rem, env(safe-area-inset-left, 0px));
    padding-right: max(1.5rem, env(safe-area-inset-right, 0px));
  }
}

/* Toast 通知定位：底部 + 安全区域 */
.toast-container {
  bottom: calc(0.75rem + env(safe-area-inset-bottom, 0px));
}
@media (min-width: 640px) {
  .toast-container {
    bottom: calc(1rem + env(safe-area-inset-bottom, 0px));
  }
}
</style>
