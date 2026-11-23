/**
 * 把异常转换为面向用户的友好提示。
 * 技术细节（网络异常、JSON 解析失败等）不上屏，仅交由 console 供开发者排查。
 */
export function toUserMessage(err) {
  if (err instanceof SyntaxError) {
    return '服务器返回数据格式异常，请稍后重试'
  }
  if (err instanceof TypeError) {
    return '网络请求失败，请检查网络连接后重试'
  }
  if (err && typeof err.message === 'string' && err.message) {
    return err.message
  }
  return '操作失败，请稍后重试'
}

/** 统一在控制台输出原始错误，便于开发者排查（页面只展示友好提示） */
export function logError(label, err) {
  console.error(`[RepoWatcher] ${label}:`, err)
}
