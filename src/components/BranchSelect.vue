<template>
  <div ref="rootEl" class="branch-select">
    <input ref="inputEl" :value="text" type="text" autocomplete="off" spellcheck="false"
      :placeholder="placeholder" class="cell-input branch-select__input" @input="onInput" @focus="openMenu"
      @keydown.down.prevent="move(1)" @keydown.up.prevent="move(-1)" @keydown.enter.prevent="pickActive"
      @keydown.esc.stop.prevent="closeMenu" @keydown.tab="closeMenu" @blur="onBlur" />
    <button type="button" tabindex="-1" class="branch-select__caret" :class="{ 'is-open': open }"
      aria-label="展开分支列表" @mousedown.prevent="toggle">
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M6 8l4 4 4-4" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
    </button>

    <Teleport to="body">
      <ul v-if="open && items.length" ref="menuEl" class="branch-select__menu"
        :style="{ top: pos.top + 'px', left: pos.left + 'px', width: pos.width + 'px' }">
        <li v-for="(item, idx) in items" :key="item.key" class="branch-select__item"
          :class="{ 'is-active': idx === activeIdx }" @mousedown.prevent="pick(item.value)"
          @mousemove="activeIdx = idx">
          <span class="truncate">{{ item.label }}</span>
          <span v-if="item.hint" class="branch-select__hint">{{ item.hint }}</span>
        </li>
      </ul>
    </Teleport>
  </div>
</template>

<script setup>
import { ref, computed, nextTick, onBeforeUnmount } from 'vue'
import { COMMON_BRANCHES } from '../utils/branches.js'

const props = defineProps({
  modelValue: { type: String, default: '' },
  // 可选项列表，默认使用常用分支名
  options: { type: Array, default: () => COMMON_BRANCHES },
  // 值为空（跟随默认分支）时的占位文案
  placeholder: { type: String, default: '' },
  // 传入后会在菜单顶部提供「留空」选项
  emptyLabel: { type: String, default: '' },
})
const emit = defineEmits(['update:modelValue'])

const rootEl = ref(null)
const inputEl = ref(null)
const menuEl = ref(null)
const open = ref(false)
const activeIdx = ref(-1)
const pos = ref({ top: 0, left: 0, width: 0 })

const text = computed(() => props.modelValue || '')

// 菜单项：留空选项 + 匹配的预设分支 + 自定义值
const items = computed(() => {
  const kw = text.value.trim().toLowerCase()
  const list = []

  if (props.emptyLabel && text.value !== '') {
    list.push({ key: '__empty__', value: '', label: props.emptyLabel })
  }

  for (const opt of props.options) {
    if (kw && !opt.toLowerCase().includes(kw)) continue
    list.push({
      key: opt,
      value: opt,
      label: opt,
      hint: opt === text.value ? '当前' : '',
    })
  }

  if (kw && !props.options.some(o => o.toLowerCase() === kw)) {
    list.push({ key: '__custom__', value: text.value.trim(), label: `使用 “${text.value.trim()}”`, hint: '自定义' })
  }

  return list
})

function updateValue(v) {
  emit('update:modelValue', v)
}

function onInput(e) {
  updateValue(e.target.value.trim())
  openMenu()
}

function pick(v) {
  updateValue(v)
  closeMenu()
  inputEl.value?.focus()
}

function pickActive() {
  if (!open.value) { openMenu(); return }
  const idx = activeIdx.value >= 0 ? activeIdx.value : 0
  if (items.value[idx]) pick(items.value[idx].value)
}

function move(step) {
  if (!open.value) { openMenu(); return }
  const len = items.value.length
  if (!len) return
  activeIdx.value = (activeIdx.value + step + len) % len
  nextTick(scrollActiveIntoView)
}

function scrollActiveIntoView() {
  const el = menuEl.value?.children?.[activeIdx.value]
  if (el?.scrollIntoView) el.scrollIntoView({ block: 'nearest' })
}

async function openMenu() {
  open.value = true
  activeIdx.value = -1
  await nextTick()
  // 1.0.2 竞态修复：nextTick 期间可能已被 closeMenu（blur / tab / 点击外部）关闭。
  // 此时若继续 placeMenu 并注册全局监听，会留下「幽灵监听器」并让菜单重新定位于已关闭状态。
  if (!open.value) return
  placeMenu()
  document.addEventListener('mousedown', onDocMouseDown, true)
  window.addEventListener('resize', placeMenu)
  window.addEventListener('scroll', placeMenu, true)
}

function closeMenu() {
  open.value = false
  activeIdx.value = -1
  document.removeEventListener('mousedown', onDocMouseDown, true)
  window.removeEventListener('resize', placeMenu)
  window.removeEventListener('scroll', placeMenu, true)
}

function toggle() {
  if (open.value) { closeMenu(); return }
  inputEl.value?.focus()
  openMenu()
}

// 菜单挂载在 body 上，点击组件与菜单之外时才关闭（菜单项用 mousedown.prevent 保持焦点）
function onDocMouseDown(e) {
  if (rootEl.value?.contains(e.target)) return
  if (menuEl.value?.contains(e.target)) return
  closeMenu()
}

function onBlur() {
  if (open.value) closeMenu()
}

function placeMenu() {
  const rect = inputEl.value?.getBoundingClientRect()
  if (!rect) return
  const below = window.innerHeight - rect.bottom
  const height = Math.min(items.value.length * 30 + 8, 220)
  pos.value = {
    left: rect.left,
    width: Math.max(rect.width, 160),
    // 下方空间不足时向上翻转
    top: below < height + 8 && rect.top > below ? rect.top - height - 4 : rect.bottom + 4,
  }
}

onBeforeUnmount(closeMenu)
</script>

<style scoped>
.branch-select {
  position: relative;
  width: 100%;
}

.branch-select__input {
  padding-right: 24px;
}

.branch-select__caret {
  position: absolute;
  top: 50%;
  right: 4px;
  transform: translateY(-50%);
  display: flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 4px;
  color: #94a3b8;
  transition: transform 0.15s ease, color 0.15s ease, background-color 0.15s ease;
}
.branch-select__caret:hover {
  color: #64748b;
  background: rgba(15, 23, 42, 0.05);
}
.branch-select__caret.is-open {
  transform: translateY(-50%) rotate(180deg);
  color: #2563eb;
}
.branch-select__caret svg {
  width: 14px;
  height: 14px;
}

@media (prefers-color-scheme: dark) {
  .branch-select__caret {
    color: #64748b;
  }
  .branch-select__caret:hover {
    color: #cbd5e1;
    background: rgba(148, 163, 184, 0.15);
  }
  .branch-select__caret.is-open {
    color: #3b82f6;
  }
}
</style>

<style>
/* 菜单通过 Teleport 挂到 body，需使用非 scoped 样式 */
.branch-select__menu {
  position: fixed;
  z-index: 60;
  max-height: 220px;
  max-width: calc(100vw - 24px);
  overflow-y: auto;
  padding: 4px;
  margin: 0;
  list-style: none;
  border-radius: 8px;
  border: 1px solid rgba(15, 23, 42, 0.08);
  background: #fff;
  box-shadow: 0 4px 6px -1px rgba(15, 23, 42, 0.06), 0 12px 28px -6px rgba(15, 23, 42, 0.15);
}

.branch-select__item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 7px 8px;
  border-radius: 6px;
  font-size: 13px;
  color: #334155;
  cursor: pointer;
  white-space: nowrap;
}

/* 移动端增加菜单项触控高度，防止误触相邻选项 */
@media (max-width: 768px) {
  .branch-select__item {
    padding-top: 10px;
    padding-bottom: 10px;
    font-size: 14px;
  }
}
.branch-select__item.is-active {
  background: rgba(37, 99, 235, 0.08);
  color: #2563eb;
}

.branch-select__hint {
  flex-shrink: 0;
  font-size: 11px;
  color: #94a3b8;
}
.branch-select__item.is-active .branch-select__hint {
  color: #60a5fa;
}

@media (prefers-color-scheme: dark) {
  .branch-select__menu {
    border-color: rgba(148, 163, 184, 0.18);
    background: #1e293b;
    box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.4), 0 12px 28px -6px rgba(0, 0, 0, 0.5);
  }
  .branch-select__item {
    color: #cbd5e1;
  }
  .branch-select__item.is-active {
    background: rgba(59, 130, 246, 0.18);
    color: #93c5fd;
  }
}
</style>
