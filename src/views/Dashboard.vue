<template>
  <div class="min-h-dvh">
    <!-- 主内容 -->
    <main class="pt-1">
      <!-- 平台标签栏 -->
      <div class="platform-tabs mb-5 sm:mb-6">
        <button v-for="tab in tabs" :key="tab.key"
          @click="activeTab = tab.key"
          class="inline-flex items-center gap-1.5 px-3.5 sm:px-4 py-2.5 sm:py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap"
          :class="activeTab === tab.key
            ? 'bg-blue-600 text-white shadow-sm'
            : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/60'">
          <BrandIcon :platform="tab.icon" class="w-4 h-4" />
          <span>{{ tab.label }}</span>
          <span class="text-[11px] font-medium px-1.5 py-0.5 rounded-full"
            :class="activeTab === tab.key
              ? 'bg-white/20 text-white'
              : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400'">
            {{ countByPlatform(tab.key) }}
          </span>
        </button>
      </div>

      <!-- 错误状态 -->
      <div v-if="error"
        class="rounded-xl border border-red-200 bg-red-50 dark:bg-red-500/5 dark:border-red-500/20 px-6 py-8 text-center">
        <p class="text-sm font-medium text-red-600 dark:text-red-400 mb-2">加载失败</p>
        <p class="text-sm text-red-500/80 dark:text-red-400/60">{{ error }}</p>
        <button @click="loadData"
          class="mt-4 inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm bg-red-600 hover:bg-red-500 text-white transition-colors">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path>
          </svg>
          重试
        </button>
      </div>

      <!-- 仓库列表容器 -->
      <div v-else class="space-y-3">
        <!-- 空状态 -->
        <div v-if="sortedRepos(activeTab).length === 0 && !loading"
          class="rounded-xl border border-dashed border-slate-300 dark:border-slate-700 px-6 py-12 text-center">
          <div class="flex flex-col items-center gap-3">
            <BrandIcon :platform="activeTab" class="w-10 h-10 text-slate-300 dark:text-slate-600" />
            <p class="text-sm text-slate-400 dark:text-slate-500">
              暂无 {{ activeSection?.label }} 仓库配置
            </p>
            <RouterLink to="/admin" class="text-xs text-blue-600 dark:text-blue-400 hover:underline">
              {{ isLoggedIn ? '前往管理后台添加仓库 →' : '登录后可添加仓库 →' }}
            </RouterLink>
          </div>
        </div>

        <!-- 加载骨架屏 -->
        <template v-else-if="loading && !data">
          <div v-for="i in 4" :key="i"
            class="rounded-xl border border-slate-200 dark:border-slate-800 px-5 py-4 animate-pulse">
            <div class="flex items-center justify-between gap-4">
              <div class="space-y-2 flex-1">
                <div class="h-4 bg-slate-200 dark:bg-slate-700 rounded w-40"></div>
                <div class="h-3 bg-slate-100 dark:bg-slate-800 rounded w-56"></div>
              </div>
              <div class="h-3 bg-slate-200 dark:bg-slate-700 rounded w-20"></div>
            </div>
          </div>
        </template>

        <!-- 仓库列表 -->
        <template v-else>
          <div class="repo-scroll-container space-y-2.5">
            <RepoCard v-for="repo in sortedRepos(activeTab)" :key="repo.key" :repo="repo" />
          </div>
        </template>
      </div>
    </main>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { RouterLink } from 'vue-router'
import RepoCard from '../components/RepoCard.vue'
import BrandIcon from '../components/BrandIcon.vue'
import { useRepos } from '../composables/useRepos.js'
import { useAdminAuth } from '../composables/useAdminAuth.js'

const { data, loading, error, loadData, startAutoRefresh } = useRepos()
// 1.0.1：未登录只读展示仪表盘，编辑入口按登录态显示
const { isLoggedIn } = useAdminAuth()

const activeTab = ref('github')

// 选项卡定义
const tabs = [
  { key: 'github', icon: 'github', label: 'GitHub' },
  { key: 'cnb', icon: 'cnb', label: 'CNB' },
  { key: 'gitee', icon: 'gitee', label: 'Gitee' },
  { key: 'gitlab', icon: 'gitlab', label: 'GitLab' },
  { key: 'gitcode', icon: 'gitcode', label: 'GitCode' },
]

const sections = {
  github: { key: 'github', icon: 'github', title: 'GitHub 仓库', label: 'GitHub' },
  cnb: { key: 'cnb', icon: 'cnb', title: 'CNB 仓库', label: 'CNB' },
  gitee: { key: 'gitee', icon: 'gitee', title: 'Gitee 仓库', label: 'Gitee' },
  gitlab: { key: 'gitlab', icon: 'gitlab', title: 'GitLab 仓库', label: 'GitLab' },
  gitcode: { key: 'gitcode', icon: 'gitcode', title: 'GitCode 仓库', label: 'GitCode' },
}

const activeSection = computed(() => sections[activeTab.value])

function countByPlatform(platform) {
  if (!data.value?.repos) return 0
  return data.value.repos.filter((r) => r.platform === platform).length
}

function sortedRepos(platform) {
  if (!data.value?.repos) return []
  return data.value.repos
    .filter((r) => r.platform === platform)
    .sort((a, b) => {
      const da = a.latestDate ? new Date(a.latestDate).getTime() : 0
      const db = b.latestDate ? new Date(b.latestDate).getTime() : 0
      return db - da // 倒序：最近更新的在前
    })
}

onMounted(startAutoRefresh)
</script>

<style scoped>
/* 仓库列表容器：内部自滚动 */
.repo-scroll-container {
  overflow-y: auto;
}

@media (max-width: 768px) {
  .repo-scroll-container {
    max-height: none;
    overflow-y: visible;
  }
}

/* 平台标签：移动端横向滚动，避免 flex-wrap 造成的换行错位 */
.platform-tabs {
  display: flex;
  align-items: center;
  gap: 6px;
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
  scrollbar-width: none !important; /* Firefox：始终隐藏 */
}
.platform-tabs::-webkit-scrollbar {
  display: none !important; /* WebKit：始终隐藏 */
}
@media (min-width: 640px) {
  .platform-tabs {
    flex-wrap: wrap;
    overflow-x: visible;
  }
}
</style>
