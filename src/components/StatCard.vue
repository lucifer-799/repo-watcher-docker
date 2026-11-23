<template>
  <div class="surface-card surface-card--interactive p-5 cursor-pointer"
    :class="isActive ? 'border-blue-500/50' : ''"
    @click="$emit('click')">
    <div class="flex items-start justify-between gap-3">
      <div class="min-w-0">
        <p class="text-sm text-slate-500 dark:text-slate-400 mb-1.5">{{ title }}</p>
        <p class="text-2xl font-semibold text-slate-900 dark:text-white tracking-tight">{{ value }}</p>
      </div>
      <div class="w-10 h-10 rounded-lg flex items-center justify-center shrink-0"
        :class="[iconBg, iconColor]">
        <slot name="icon" />
      </div>
    </div>
  </div>
</template>

<script setup>
defineProps({
  title: { type: String, required: true },
  value: { type: [String, Number], default: '-' },
  iconBg: { type: String, default: '' },
  iconColor: { type: String, default: '' },
  isActive: { type: Boolean, default: false },
})

defineEmits(['click'])
</script>
