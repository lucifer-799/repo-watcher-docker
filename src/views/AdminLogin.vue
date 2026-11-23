<template>
  <div class="min-h-dvh flex items-center justify-center admin-auth-wrap">
    <div class="w-full max-w-[380px]">
      <div class="surface-card p-5 sm:p-8">
        <h1 class="text-lg font-semibold text-slate-900 dark:text-white tracking-tight mb-6">管理员登录</h1>

        <form @submit.prevent="submit">
          <div class="mb-4">
            <label class="form-label">用户名</label>
            <input
              v-model="user"
              type="text"
              class="form-input"
              placeholder="请输入用户名"
            />
          </div>
          <div class="mb-6">
            <label class="form-label">密码</label>
            <input
              v-model="pass"
              type="password"
              class="form-input"
              placeholder="请输入密码"
            />
          </div>

          <p v-if="error" class="text-red-500 dark:text-red-400 text-sm mb-4 bg-red-50 dark:bg-red-500/10 rounded-lg px-3 py-2">{{ error }}</p>

          <button
            type="submit"
            :disabled="loading"
            class="btn btn-primary w-full justify-center py-2.5"
          >
            {{ loading ? '登录中...' : '登录' }}
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
import router from '../router'

const { login } = useAdminAuth()
const user = ref('')
const pass = ref('')
const loading = ref(false)
const error = ref('')

async function submit() {
  error.value = ''
  loading.value = true
  try {
    await login(user.value, pass.value)
    router.push('/admin/console')
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
