<template>
  <div class="app-shell" @touchstart.passive="onTouchStart" @touchend.passive="onTouchEnd">
    <!-- 移动端遮罩：点击空白处关闭菜单 -->
    <div v-if="menuOpen" class="menu-backdrop" @click="menuOpen = false"></div>

    <!-- 左侧悬浮圆角菜单 -->
    <SideMenu :open="menuOpen" />

    <!-- 右侧主内容 -->
    <main class="app-main">
      <RouterView />
    </main>
  </div>
</template>

<script setup>
import { ref, watch, onMounted, onUnmounted } from 'vue'
import { RouterView, useRoute } from 'vue-router'
import SideMenu from './components/SideMenu.vue'
import { useRepos } from './composables/useRepos.js'
import { useAdminAuth } from './composables/useAdminAuth.js'

const { startAutoRefresh } = useRepos()
const { isLoggedIn } = useAdminAuth()
const menuOpen = ref(false)
const route = useRoute()

// 路由切换时关闭移动端菜单
watch(
  () => route.fullPath,
  () => {
    menuOpen.value = false
  }
)

// 1.0.2 移动端 backdrop 修复：侧栏滑出时锁定 body 滚动。
// 原先只渲染半透明遮罩却不锁滚动，遮罩下方页面仍可滑动（触摸滚动穿透），
// 用户滑动遮罩会滚到背后内容，观感上像「点击遮罩没反应 / 菜单乱跳」。
watch(menuOpen, (v) => {
  if (typeof document === 'undefined') return
  document.body.style.overflow = v ? 'hidden' : ''
})

onUnmounted(() => {
  if (typeof document !== 'undefined') document.body.style.overflow = ''
})

// 登录状态变化时启动全局自动刷新（幂等）；匿名态由 Dashboard 自行拉取只读数据
watch(
  isLoggedIn,
  (active) => { if (active) startAutoRefresh() },
  { immediate: true }
)

// 移动端手势：右滑（从左边缘）打开菜单，左滑收起菜单
const touchStart = { x: 0, y: 0 }
const SWIPE_THRESHOLD = 50

function onTouchStart(e) {
  const t = e.touches[0]
  if (!t) return
  touchStart.x = t.clientX
  touchStart.y = t.clientY
}

function onTouchEnd(e) {
  const t = e.changedTouches[0]
  if (!t) return
  const dx = t.clientX - touchStart.x
  const dy = t.clientY - touchStart.y
  // 仅识别明显的横向滑动，避免与纵向滚动冲突
  if (Math.abs(dx) < SWIPE_THRESHOLD || Math.abs(dx) < Math.abs(dy)) return
  if (!menuOpen.value && dx > 0 && touchStart.x < 40) {
    // 从屏幕左边缘右滑打开
    menuOpen.value = true
  } else if (menuOpen.value && dx < 0) {
    // 菜单打开时左滑收起
    menuOpen.value = false
  }
}

onMounted(() => {
  window.addEventListener('touchstart', onTouchStart, { passive: true })
  window.addEventListener('touchend', onTouchEnd, { passive: true })
})
onUnmounted(() => {
  window.removeEventListener('touchstart', onTouchStart)
  window.removeEventListener('touchend', onTouchEnd)
})
</script>
