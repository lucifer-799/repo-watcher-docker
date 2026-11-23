<template>
  <div class="repo-card group cursor-pointer select-none transition-colors"
    @click="openRepo" title="点击打开仓库页面">
    <!-- 移动端两行布局 / 桌面端单行布局 -->
    <div class="repo-card__inner">
      <!-- 顶部行：状态 + 名称 + 分支/标签 -->
      <div class="repo-card__header">
        <span class="shrink-0"
          :class="statusActive
            ? 'status-dot status-dot--active text-emerald-600 dark:text-emerald-400'
            : 'status-dot status-dot--inactive text-amber-600 dark:text-amber-400'"></span>

        <h3 class="repo-card__name">{{ repo.name }}</h3>

        <div class="repo-card__badges">
          <span v-if="!isCnb" class="repo-card__badge repo-card__badge--branch font-mono">
            {{ repo.branch }}
          </span>
          <span v-if="isRelease && repo.includePrerelease" class="repo-card__badge">
            含预发布
          </span>
          <span v-if="repo.lastCheckError"
            class="repo-card__badge repo-card__badge--error"
            :title="repo.lastCheckError">
            检测失败
          </span>
        </div>
      </div>

      <!-- 第二行：最新 / 版本 + commit/标签 + 更新时间 -->
      <div class="repo-card__meta">
        <div class="flex items-center gap-1.5 min-w-0">
          <span class="repo-card__meta-label shrink-0 sm:inline">
            {{ isRelease ? '版本' : '最新' }}
          </span>
          <code :class="[valueClass, 'repo-card__value']">{{ displayValue }}</code>
        </div>

        <span v-if="repo.latestDate" class="repo-card__time shrink-0">
          {{ formatRelativeTime(repo.latestDate) }}
        </span>
        <span v-else-if="isChecked" class="repo-card__time shrink-0" title="最近一次检测时间">
          检测于 {{ formatRelativeTime(repo.lastCheckedAt) }}
        </span>

        <svg class="repo-card__arrow shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"></path>
        </svg>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { formatRelativeTime } from '../utils/time.js'

const props = defineProps({
  repo: { type: Object, required: true },
})

const isCnb = computed(() => props.repo.platform === 'cnb')

const valueClass = computed(() => ({
  github: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400',
  gitee: 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-400',
  gitlab: 'bg-orange-50 text-orange-700 dark:bg-orange-500/10 dark:text-orange-400',
  cnb: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400',
}[props.repo.platform] || 'bg-slate-100 text-slate-700 dark:bg-slate-700/60 dark:text-slate-300'))

const isRelease = computed(() => props.repo.source === 'release')

// 是否已执行过检测（有检测时间且非失败）：用于区分「从未检测」与「已检测但暂无版本数据」
const isChecked = computed(() => !!props.repo.lastCheckedAt && props.repo.lastCheckStatus !== 'error')

// release 依据展示完整 tag，commit 依据展示 8 位短 SHA
const displayValue = computed(() => {
  if (isRelease.value) {
    return props.repo.latestTag || (isChecked.value ? '暂无版本数据' : '未检测')
  }
  return props.repo.latestSha
    ? props.repo.latestSha.substring(0, 8)
    : (isChecked.value ? '暂无版本数据' : '未检测')
})

// 状态点：已成功检测（无论是否取到版本）视为存活（绿）；仅「从未检测」或「检测失败」用非活跃态（琥珀/红）
const statusActive = computed(() => {
  if (props.repo.lastCheckStatus === 'error') return false
  return isChecked.value
})

function openRepo() {
  if (props.repo.url) window.open(props.repo.url, '_blank')
}
</script>

<style scoped>
.repo-card {
  border: 1px solid rgba(15, 23, 42, 0.06);
  border-radius: 12px;
  background: #fff;
  transition: border-color 0.15s ease, box-shadow 0.15s ease, background-color 0.15s ease;
}

.repo-card:hover {
  border-color: rgba(37, 99, 235, 0.3);
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.03), 0 4px 16px rgba(37, 99, 235, 0.08);
}

@media (prefers-color-scheme: dark) {
  .repo-card {
    border-color: rgba(148, 163, 184, 0.1);
    background: #0f172a;
  }
  .repo-card:hover {
    border-color: rgba(59, 130, 246, 0.4);
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3), 0 8px 24px rgba(0, 0, 0, 0.3);
  }
}

/* 默认（含移动端）：双行堆叠布局 */
.repo-card__inner {
  padding: 12px 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.repo-card__header {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.repo-card__name {
  font-size: 15px;
  font-weight: 500;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  letter-spacing: -0.01em;
  min-width: 0;
  flex: 0 1 auto;
}

.repo-card__badges {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
  overflow: hidden;
  max-width: 50%;
}

.repo-card__badge {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 4px;
  background: rgba(148, 163, 184, 0.1);
  color: #64748b;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 90px;
}

.repo-card__badge--branch {
  background: rgba(148, 163, 184, 0.1);
  color: #64748b;
  font-family: 'SF Mono', 'Cascadia Code', Consolas, monospace;
}

.repo-card__badge--error {
  background: rgba(220, 38, 38, 0.1);
  color: #dc2626;
}

@media (prefers-color-scheme: dark) {
  .repo-card__name {
    color: #f1f5f9;
  }
  .repo-card__badge,
  .repo-card__badge--branch {
    background: rgba(148, 163, 184, 0.15);
    color: #94a3b8;
  }
  .repo-card__badge--error {
    background: rgba(220, 38, 38, 0.15);
    color: #f87171;
  }
}

.repo-card__meta {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.repo-card__meta > div:first-child {
  flex-shrink: 1;
  min-width: 0;
}

.repo-card__time {
  margin-left: auto;
}

.repo-card__meta-label {
  font-size: 11px;
  color: #94a3b8;
  flex-shrink: 0;
}

.repo-card__value {
  font-size: 11px;
  font-family: 'SF Mono', 'Cascadia Code', Consolas, monospace;
  font-weight: 500;
  padding: 2px 8px;
  border-radius: 6px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.repo-card__time {
  font-size: 11px;
  color: #94a3b8;
  white-space: nowrap;
  flex-shrink: 0;
  text-align: right;
}

.repo-card__arrow {
  width: 14px;
  height: 14px;
  color: #cbd5e1;
  transition: color 0.15s ease;
  flex-shrink: 0;
}

.repo-card:hover .repo-card__arrow {
  color: #94a3b8;
}

@media (prefers-color-scheme: dark) {
  .repo-card__time {
    color: #64748b;
  }
  .repo-card__arrow {
    color: #475569;
  }
  .repo-card:hover .repo-card__arrow {
    color: #64748b;
  }
}

/* 桌面端（sm 以上）：恢复单行紧凑布局 */
@media (min-width: 640px) {
  .repo-card__inner {
    flex-direction: row;
    align-items: center;
    gap: 16px;
    padding: 16px 20px;
  }

  .repo-card__header {
    flex: 3;
    gap: 12px;
  }

  .repo-card__name {
    flex: 0 1 auto;
  }

  .repo-card__badges {
    max-width: none;
  }

  .repo-card__badge {
    font-size: 11px;
    padding: 2px 6px;
    max-width: none;
  }

  .repo-card__badge--error {
    font-size: 10px;
  }

  .repo-card__meta {
    flex: 1;
    gap: 10px;
  }

  .repo-card__meta-label {
    display: inline;
  }

  .repo-card__value {
    font-size: 11px;
    padding: 3px 8px;
    max-width: none;
  }

  .repo-card__time {
    font-size: 12px;
  }
}
</style>
