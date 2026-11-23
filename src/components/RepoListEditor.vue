<template>
  <div class="space-y-3">
    <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5">
      <label class="block text-sm font-medium text-slate-600 dark:text-slate-300">仓库列表（仓库名 / 分支 / 备注）</label>
      <div class="flex gap-2 flex-shrink-0">
        <button type="button" @click="showPaste = true"
          class="repo-editor-action px-3 py-2 sm:px-3 sm:py-1.5 text-xs rounded-md bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 transition-colors">
          批量粘贴
        </button>
        <button type="button" @click="addRow"
          class="repo-editor-action px-3 py-2 sm:px-3 sm:py-1.5 text-xs rounded-md bg-blue-600 hover:bg-blue-500 text-white transition-colors">
          + 添加仓库
        </button>
      </div>
    </div>

    <div v-if="!rows.length"
      class="text-sm text-slate-400 dark:text-slate-500 py-8 px-4 text-center border border-dashed border-slate-300 dark:border-slate-700 rounded-lg">
      暂无仓库，点击上方「添加仓库」或「批量粘贴」导入
    </div>

    <!-- 有仓库数据时：桌面端表格 + 移动端卡片 -->
    <div v-else>
      <!-- 桌面端（≥768px）：表格布局 -->
      <div class="repo-editor-table hidden md:block overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700">
        <table class="w-full text-sm">
          <thead>
            <tr class="bg-slate-50 dark:bg-slate-800/60 text-slate-500 dark:text-slate-400">
              <th class="text-left font-medium px-3 py-2.5 w-[22%]">仓库名</th>
              <th class="text-left font-medium px-3 py-2.5 w-[14%]">分支</th>
              <th class="text-left font-medium px-3 py-2.5 w-[13%]">更新依据</th>
              <th v-if="showPrereleaseColumn" class="text-left font-medium px-3 py-2.5 w-[12%]">预发布</th>
              <th class="text-left font-medium px-3 py-2.5">备注</th>
              <th class="px-3 py-2.5 w-10"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(row, i) in rows" :key="i" class="border-t border-slate-100 dark:border-slate-800">
              <td class="px-2 py-1.5">
                <input v-model.trim="row.repo" placeholder="owner/repo" class="cell-input" />
              </td>
              <td class="px-2 py-1.5">
                <BranchSelect v-model="row.branch" :placeholder="defaultBranch"
                  :empty-label="`${defaultBranch}`" />
              </td>
              <td class="px-2 py-1.5">
                <div class="flex items-center gap-1">
                  <select v-model="row.source"
                    :disabled="sourceDisabled"
                    class="cell-select text-xs disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                    <option value="commit">Commit 提交</option>
                    <option value="release">Release 发版</option>
                  </select>
                  <span v-if="sourceDisabled" :title="disabledReason"
                    class="text-amber-500 cursor-help shrink-0 select-none text-xs">⚠</span>
                </div>
              </td>
              <td v-if="showPrereleaseColumn" class="px-2 py-1.5">
                <label class="flex items-center gap-1.5 cursor-pointer select-none"
                  :class="row.source === 'release' ? '' : 'opacity-40 cursor-not-allowed'">
                  <input type="checkbox" v-model="row.includePrerelease"
                    :disabled="row.source !== 'release'"
                    class="w-3.5 h-3.5 accent-blue-600 rounded disabled:cursor-not-allowed" />
                  <span class="text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">含预发布</span>
                </label>
              </td>
              <td class="px-2 py-1.5">
                <input v-model.trim="row.note" placeholder="可选备注" class="cell-input" />
              </td>
              <td class="px-2 py-1.5 text-center">
                <div class="flex items-center justify-center gap-1">
                  <button type="button" @click="emitCheck(row)" :disabled="isChecking(row)" title="检查该仓库"
                    class="text-slate-400 hover:text-blue-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-4.35-4.35M17 11a6 6 0 11-12 0 6 6 0 0112 0z"></path>
                    </svg>
                  </button>
                  <button type="button" @click="removeRow(i)" title="删除"
                    class="text-slate-400 hover:text-rose-500 transition-colors">✕</button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- 移动端（<768px）：卡片式布局，每行一个卡片，字段垂直堆叠 -->
      <div class="repo-editor-cards space-y-2.5 md:hidden">
        <div v-for="(row, i) in rows" :key="i"
          class="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-3.5 space-y-3">
          <!-- 首行：序号 + 仓库名 -->
          <div class="flex items-start gap-2">
            <span class="flex items-center justify-center w-6 h-6 mt-1 rounded-full bg-slate-100 dark:bg-slate-800 text-[11px] font-medium text-slate-500 dark:text-slate-400 shrink-0">
              {{ i + 1 }}
            </span>
            <div class="flex-1 min-w-0">
              <input v-model.trim="row.repo" placeholder="owner/repo" class="cell-input cell-input--mobile" />
            </div>
            <button type="button" @click="emitCheck(row)" :disabled="isChecking(row)" title="检查该仓库"
              class="shrink-0 flex items-center justify-center w-8 h-8 rounded-md text-slate-400 dark:text-slate-500 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-500/10 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-4.35-4.35M17 11a6 6 0 11-12 0 6 6 0 0112 0z"></path>
              </svg>
            </button>
            <button type="button" @click="removeRow(i)" title="删除该行"
              class="shrink-0 flex items-center justify-center w-8 h-8 rounded-md text-slate-400 dark:text-slate-500 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-500/10 transition-colors">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path>
              </svg>
            </button>
          </div>

          <!-- 分支 + 更新依据 -->
          <div class="grid grid-cols-2 gap-2.5">
            <div>
              <label class="repo-editor__label">分支</label>
              <BranchSelect v-model="row.branch" :placeholder="defaultBranch"
                :empty-label="`${defaultBranch}`" />
            </div>
            <div>
              <label class="repo-editor__label">更新依据</label>
              <div class="flex items-center gap-1">
                <select v-model="row.source"
                  :disabled="sourceDisabled"
                  class="cell-select cell-select--mobile disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                  <option value="commit">Commit 提交</option>
                  <option value="release">Release 发版</option>
                </select>
                <span v-if="sourceDisabled" :title="disabledReason"
                  class="text-amber-500 cursor-help shrink-0 select-none text-xs">⚠</span>
              </div>
            </div>
          </div>

          <!-- 预发布 -->
          <div v-if="showPrereleaseColumn">
            <label class="repo-editor__label">预发布</label>
            <label class="flex items-center gap-2 py-1.5 cursor-pointer select-none"
              :class="row.source === 'release' ? '' : 'opacity-40 cursor-not-allowed'">
              <input type="checkbox" v-model="row.includePrerelease"
                :disabled="row.source !== 'release'"
                class="w-4 h-4 accent-blue-600 rounded disabled:cursor-not-allowed" />
              <span class="text-sm text-slate-600 dark:text-slate-300">包含预发布版本</span>
            </label>
          </div>

          <!-- 备注 -->
          <div>
            <label class="repo-editor__label">备注</label>
            <input v-model.trim="row.note" placeholder="可选备注" class="cell-input cell-input--mobile" />
          </div>
        </div>
      </div>
    </div>

<!-- 批量粘贴弹窗 -->
    <div v-if="showPaste"
      class="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 dark:bg-black/60 p-3 sm:p-4 backdrop-blur-sm"
      @click.self="showPaste = false"
      style="padding-top: calc(1rem + var(--safe-top)); padding-bottom: calc(1rem + var(--safe-bottom));">
      <div class="surface-card w-full max-w-lg p-4 sm:p-6 space-y-3.5 overflow-y-auto max-h-[90dvh]">
        <div class="flex items-center justify-between">
          <h3 class="text-base font-semibold text-slate-900 dark:text-white tracking-tight">批量粘贴解析</h3>
          <button type="button" @click="showPaste = false" aria-label="关闭"
            class="flex items-center justify-center w-8 h-8 rounded-md text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
            </svg>
          </button>
        </div>
        <p class="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
          每行一个仓库，支持格式：<code>owner/repo</code>、<code>owner/repo@branch</code>，
          备注可用空格 / 逗号 / # / - 与仓库名分隔，例如
          <code>owner/repo my-app</code> 或 <code>owner/repo@main 后端服务</code>。
          追加 <code>#release</code> 可将更新依据设为发版，如 <code>owner/repo@main#release</code>；
          不写则默认 <code>#commit</code>。
        </p>
        <p v-if="platform === 'cnb'" class="text-xs text-slate-500 dark:text-slate-400">
          CNB 已提供 Release 接口，可在仓库后追加 <code>#release</code> 按发版检测。
        </p>
        <textarea v-model="pasteText" rows="6" placeholder="owner/repo@main 备注"
          class="form-input font-mono resize-none paste-textarea"></textarea>
        <p v-if="parseHint" class="text-xs font-medium"
          :class="parseOk ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500'">
          {{ parseHint }}
        </p>
        <div class="flex justify-end gap-2 pt-1">
          <button type="button" @click="showPaste = false"
            class="btn btn-secondary text-xs">
            取消
          </button>
          <button type="button" @click="applyPaste"
            class="btn btn-primary text-xs">
            解析并添加
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import BranchSelect from './BranchSelect.vue'

const props = defineProps({
  modelValue: { type: Array, default: () => [] },
  defaultBranch: { type: String, default: 'main' },
  platform: { type: String, default: 'github' },
  // 正在检测中的仓库唯一键集合（由父组件维护：platform|repo|branch），用于禁用对应按钮
  checkingKeys: { type: Object, default: () => new Set() },
})
const emit = defineEmits(['update:modelValue', 'check'])

// 计算某行对应的检测键，与父组件保持一致
function rowKey(row) {
  return `${props.platform}|${row.repo}|${row.branch || ''}`
}
function isChecking(row) {
  return !!props.checkingKeys?.has?.(rowKey(row))
}
function emitCheck(row) {
  if (!row.repo || isChecking(row)) return
  emit('check', { repo: row.repo, branch: row.branch || '' })
}

// CNB 已提供 /-/releases Open API，与 GitHub / Gitee 一致支持 Release 检测依据
const sourceDisabled = computed(() => false)
const disabledReason = ''

// GitLab / GitCode 无预发布概念，隐藏「含预发布」列；CNB 现支持预发布
const showPrereleaseColumn = computed(() => props.platform !== 'gitlab' && props.platform !== 'gitcode')

const rows = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
})

const showPaste = ref(false)
const pasteText = ref('')
const parseHint = ref('')
const parseOk = ref(true)

function addRow() {
  emit('update:modelValue', [
    ...props.modelValue,
    { repo: '', branch: '', note: '', source: 'commit', includePrerelease: false },
  ])
}

function removeRow(i) {
  const next = props.modelValue.slice()
  next.splice(i, 1)
  emit('update:modelValue', next)
}

/**
 * 解析粘贴文本为多行仓库条目
 * - 先剥离更新依据标记（#release / #commit），否则会被并入备注
 * - 再按 @ 提取分支（分支止于第一个空白，其后内容仍作为备注）
 * - 最后按 owner/repo 匹配，剩余部分作为备注（去除前导分隔符）
 */
function parsePasted(text) {
  const lines = (text || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean)
  const result = []
  let invalid = 0
  for (const line of lines) {
    let source = 'commit'
    let rest = line

    const marker = rest.match(/#(release|commit)(?=\s|$)/i)
    if (marker) {
      source = marker[1].toLowerCase() === 'release' ? 'release' : 'commit'
      rest = (rest.slice(0, marker.index) + rest.slice(marker.index + marker[0].length)).trim()
    }

    let branch = ''
    const atIdx = rest.indexOf('@')
    if (atIdx !== -1) {
      const after = rest.slice(atIdx + 1)
      const end = after.search(/[\s,]/)
      branch = (end === -1 ? after : after.slice(0, end)).trim()
      rest = (end === -1
        ? rest.slice(0, atIdx)
        : rest.slice(0, atIdx) + ' ' + after.slice(end)).trim()
    }

    const m = rest.match(/^([\w.\-]+)\/([\w.\-]+)(.*)$/)
    if (!m) { invalid++; continue }
    const note = m[3].replace(/^[\s,#\-:：]+/, '').trim()
    result.push({
      repo: `${m[1]}/${m[2]}`,
      branch,
      note,
      source,
      includePrerelease: false,
    })
  }
  return { result, invalid }
}

function applyPaste() {
  const { result, invalid } = parsePasted(pasteText.value)
  if (!result.length) {
    parseOk.value = false
    parseHint.value = invalid ? '未解析到有效仓库（格式应为 owner/repo）' : '请输入仓库内容'
    return
  }
  emit('update:modelValue', [...props.modelValue, ...result])
  parseOk.value = true
  parseHint.value = `已添加 ${result.length} 个仓库${invalid ? `，${invalid} 行格式无效已忽略` : ''}`
  pasteText.value = ''
  setTimeout(() => { showPaste.value = false; parseHint.value = '' }, 600)
}

// 关闭弹窗时清空提示
watch(showPaste, (v) => { if (!v) { parseHint.value = ''; parseOk.value = true } })
</script>

<style scoped>
.repo-editor__label {
  display: block;
  font-size: 12px;
  color: #64748b;
  margin-bottom: 4px;
  font-weight: 500;
}

@media (max-width: 768px) {
  .repo-editor__label {
    font-size: 13px;
  }
}

/* 移动端批量粘贴和添加按钮的触控高度 */
.repo-editor-action {
  min-height: 36px;
}

@media (prefers-color-scheme: dark) {
  .repo-editor__label {
    color: #94a3b8;
  }
}

.cell-input {
  width: 100%;
  padding: 6px 8px;
  border-radius: 6px;
  border: 1px solid rgba(15, 23, 42, 0.1);
  background: transparent;
  color: #0f172a;
  font-size: 13px;
  transition: border-color 0.15s ease, box-shadow 0.15s ease, background-color 0.15s ease;
}
.cell-input:focus {
  outline: none;
  border-color: #2563eb;
  background: rgba(255, 255, 255, 0.9);
  box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.1);
}

/* 移动端：iOS 输入框 ≥16px 防止自动缩放；提升行高便于触控 */
@media (max-width: 768px) {
  .cell-input--mobile,
  .cell-select--mobile,
  .paste-textarea {
    font-size: 16px !important;
    padding-top: 8px;
    padding-bottom: 8px;
  }
}
.cell-input::placeholder {
  color: #94a3b8;
}

.cell-select {
  width: 100%;
  padding: 6px 8px;
  border-radius: 6px;
  border: 1px solid rgba(15, 23, 42, 0.1);
  background: transparent;
  color: #0f172a;
  transition: border-color 0.15s ease;
}
.cell-select:focus {
  outline: none;
  border-color: #2563eb;
}

@media (prefers-color-scheme: dark) {
  .cell-input, .cell-select {
    border-color: rgba(148, 163, 184, 0.2);
    color: #f1f5f9;
  }
  .cell-input:focus {
    background: rgba(15, 23, 42, 0.9);
    border-color: #3b82f6;
    box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.15);
  }
  .cell-input::placeholder {
    color: #64748b;
  }
}
</style>
