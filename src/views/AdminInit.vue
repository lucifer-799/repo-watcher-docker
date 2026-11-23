<template>
  <div class="min-h-dvh flex items-center justify-center admin-auth-wrap">
    <div class="w-full max-w-[380px]">
      <div class="surface-card p-5 sm:p-8">
        <h1 class="text-lg font-semibold text-slate-900 dark:text-white tracking-tight mb-6">初始化管理员账号</h1>

        <form @submit.prevent="submit">
          <div class="mb-4">
            <label class="form-label">用户名</label>
            <input
              v-model="user"
              type="text"
              class="form-input"
              placeholder="admin"
            />
          </div>
          <div class="mb-4">
            <label class="form-label">密码（至少 6 位）</label>
            <input
              v-model="pass"
              type="password"
              class="form-input"
              placeholder="设置管理员密码"
            />
          </div>
          <div class="mb-6">
            <label class="form-label">确认密码</label>
            <input
              v-model="pass2"
              type="password"
              class="form-input"
              placeholder="再次输入密码"
            />
          </div>

          <p v-if="error" class="text-red-500 dark:text-red-400 text-sm mb-4 bg-red-50 dark:bg-red-500/10 rounded-lg px-3 py-2">{{ error }}</p>

          <button
            type="submit"
            :disabled="loading"
            class="btn btn-primary w-full justify-center py-2.5"
          >
            {{ loading ? '初始化中...' : '初始化' }}
          </button>
        </form>

        <div class="mt-5 pt-4 border-t border-slate-100 dark:border-slate-800 text-center">
          <RouterLink to="/" class="text-sm text-blue-600 dark:text-blue-400 hover:underline">返回仪表盘</RouterLink>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { RouterLink } from 'vue-router'
import { useAdminAuth } from '../composables/useAdminAuth.js'
import router, { markInitialized } from '../router'

const { apiUrl, setTokens } = useAdminAuth()
const user = ref('admin')
const pass = ref('')
const pass2 = ref('')
const loading = ref(false)
const error = ref('')

async function submit() {
  error.value = ''
  if (pass.value.length < 6) { error.value = '密码至少 6 位'; return }
  if (pass.value !== pass2.value) { error.value = '两次密码不一致'; return }

  loading.value = true
  try {
    const res = await fetch(apiUrl('/api/admin/init'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: user.value, password: pass.value })
    })
    const data = await res.json()
    if (!res.ok) { error.value = data.message || '初始化失败'; return }
    // 通知路由守卫，否则缓存仍认为未初始化，会把接下来的导航打回向导页
    markInitialized()
    // 初始化后自动登录
    const loginRes = await fetch(apiUrl('/api/admin/login'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: user.value, password: pass.value })
    })
    const loginData = await loginRes.json()
    if (loginRes.ok) {
      setTokens(loginData.data.accessToken, loginData.data.refreshToken, loginData.data.username)
      router.push('/admin/console')
    } else {
      router.push('/admin/login')
    }
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}
</script>
<style scoped>
/* 安全区 padding */
.admin-auth-wrap {
  padding-left: calc(1rem + env(safe-area-inset-left, 0px));
  padding-right: calc(1rem + env(safe-area-inset-right, 0px));
  padding-top: env(safe-area-inset-top, 0px);
  padding-bottom: env(safe-area-inset-bottom, 0px);
}
</style>
