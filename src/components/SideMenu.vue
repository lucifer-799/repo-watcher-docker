<template>
  <aside class="side-menu" :class="{ 'side-menu--open': open }" @click.stop>
    <!-- 品牌 -->
    <div class="side-menu__brand">
      <img class="side-menu__logo" :src="`${base}favicon.svg`" alt="Repo Watcher" />
      <div class="side-menu__title">
        <h1>Repo Watcher</h1>
        <p>仓库更新监控仪表盘</p>
      </div>
    </div>

    <!-- 导航 -->
    <nav class="side-menu__nav">
      <RouterLink to="/" class="side-menu__link" active-class="side-menu__link--active">
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"></path>
        </svg>
        <span>仪表盘</span>
      </RouterLink>

      <!-- 管理后台：父级入口始终可见（未登录点击进登录/初始化）；二级菜单仅登录后显示 -->
      <div class="side-menu__group">
        <RouterLink to="/admin" class="side-menu__link" active-class="side-menu__link--active">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"></path>
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path>
          </svg>
          <span>管理后台</span>
        </RouterLink>
        <div class="side-menu__sub" v-if="isLoggedIn">
          <RouterLink
            v-for="t in visibleTabs"
            :key="t.key"
            :to="`/admin/console/${t.key}`"
            class="side-menu__sublink"
            active-class="side-menu__sublink--active">
            {{ t.label }}
          </RouterLink>
        </div>
      </div>
    </nav>

    <!-- 状态区（原顶部导航栏的状态按钮等） -->
    <div class="side-menu__status">
      <div class="side-menu__status-row">
        <span class="status-dot"
          :class="checkHealthy ? 'status-dot--active text-emerald-600 dark:text-emerald-400' : 'status-dot--inactive text-amber-600 dark:text-amber-400'"></span>
        <span class="side-menu__status-text">{{ checkStatusText }}</span>
        <button class="side-menu__refresh" @click="onRefresh" :disabled="loading" aria-label="刷新">
          <svg class="w-4 h-4" :class="{ 'refresh-spin': loading }" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path>
          </svg>
        </button>
      </div>
      <p v-if="lastCheckedAt" class="side-menu__last" :title="lastCheckedAt">{{ lastCheckedText }}</p>
    </div>

    <!-- 底部链接（原页脚） -->
    <div class="side-menu__footer">
      <div class="side-menu__links">
        <a href="https://github.com/lucifer-799/repo-watcher-docker" target="_blank" rel="noopener">GitHub</a>
        <span class="side-menu__sep">|</span>
        <a href="https://cnb.cool/magiccode1412/repo-watcher" target="_blank" rel="noopener">上游项目（原作者 MagicCode）</a>
      </div>
      <p class="side-menu__copyright">©️2026 MagicCode（原作）· Docker 版基于 MIT 二次开发</p>
    </div>
  </aside>
</template>

<script setup>
import { computed, onMounted } from 'vue'
import { RouterLink } from 'vue-router'
import { useRepos } from '../composables/useRepos.js'
import { useAdminNav } from '../composables/useAdminNav.js'
import { useAdminAuth } from '../composables/useAdminAuth.js'
import { formatRelativeTime } from '../utils/time.js'

defineProps({
  open: { type: Boolean, default: false },
})

const { visibleTabs, loadCapabilities } = useAdminNav()
// 1.0.1：未登录时只显示「仪表盘」与「管理后台」入口，二级管理菜单隐藏
const { isLoggedIn } = useAdminAuth()

const { loading, lastCheckedAt, loadData } = useRepos()

// 构建期注入的 base（Docker 版固定 '/'，可由反向代理改写）
const base = import.meta.env.BASE_URL || '/'

// 检测任务是否存活：以服务端记录的最后一次检测时间为准
const checkHealthy = computed(() => !!lastCheckedAt.value)

const lastCheckedText = computed(() =>
  lastCheckedAt.value ? `最后检测: ${formatRelativeTime(lastCheckedAt.value)}` : '尚未检测'
)

const checkStatusText = computed(() => (checkHealthy.value ? '运行中' : '未检测'))

function onRefresh() {
  loadData()
}

// 加载管理后台能力位（如定时检测是否可用），用于决定二级菜单中各选项卡可见性
onMounted(loadCapabilities)
</script>
