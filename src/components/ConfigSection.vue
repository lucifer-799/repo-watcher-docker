<template>
  <div class="surface-card p-4 sm:p-6 mb-3 sm:mb-4">
    <div class="flex items-center gap-2.5 mb-4 sm:mb-5 pb-3 sm:pb-4 border-b border-slate-100 dark:border-slate-800">
      <BrandIcon v-if="icon" :platform="icon" class="w-5 h-5 text-slate-400 dark:text-slate-500" />
      <h3 class="text-base font-semibold text-slate-900 dark:text-white tracking-tight">{{ title }}</h3>
    </div>
    <div class="space-y-4">
      <slot />
    </div>
  </div>
</template>

<script setup>
import BrandIcon from './BrandIcon.vue'

defineProps({
  title: { type: String, required: true },
  icon: { type: String, default: '' },
})
</script>
