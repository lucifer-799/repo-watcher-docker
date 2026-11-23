<template>
  <div>
    <div class="flex items-center justify-between mb-1.5">
      <label class="block text-sm font-medium text-slate-600 dark:text-slate-300">
        {{ label }}
        <span v-if="required" class="text-red-500">*</span>
      </label>
      <span class="text-[11px] px-2 py-0.5 rounded-full font-medium"
        :class="configured
          ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400'
          : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'">
        {{ configured ? '已配置' : '未配置' }}
      </span>
    </div>
    <div class="relative">
      <input
        :type="show ? 'text' : 'password'"
        :value="modelValue"
        :placeholder="placeholder"
        autocomplete="new-password"
        @input="$emit('update:modelValue', $event.target.value)"
        class="w-full px-3.5 py-2 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 transition-all"
      />
      <button
        type="button"
        @click="show = !show"
        class="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 font-medium"
      >
        {{ show ? '隐藏' : '显示' }}
      </button>
    </div>
    <p class="text-xs text-slate-400 dark:text-slate-500 mt-1.5">{{ hint }}</p>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'

const props = defineProps({
  modelValue: { type: String, default: '' },
  label: { type: String, required: true },
  required: { type: Boolean, default: false },
  placeholder: { type: String, default: '留空表示不修改' },
  configured: { type: Boolean, default: false },
})
defineEmits(['update:modelValue'])

const show = ref(false)
const hint = computed(() =>
  props.configured ? '当前已配置，留空则不修改' : '尚未配置，填写后将保存'
)
</script>
