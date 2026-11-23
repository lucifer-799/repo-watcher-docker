import { createApp } from 'vue'
import App from './App.vue'
import router from './router'
import './style.css'

// 滚动时仅为正在滚动的元素添加 .is-scrolling，使滚动条只在滚动时出现
const scrollTimers = new WeakMap()
function handleScroll(e) {
  let el = e.target
  // 视口滚动时 e.target 为 document，统一作用到根元素
  if (el === document || el === document.documentElement || el === document.body) {
    el = document.scrollingElement || document.documentElement
  }
  if (!(el instanceof Element)) return
  el.classList.add('is-scrolling')
  clearTimeout(scrollTimers.get(el))
  scrollTimers.set(
    el,
    setTimeout(() => el.classList.remove('is-scrolling'), 600)
  )
}
window.addEventListener('scroll', handleScroll, true)

createApp(App).use(router).mount('#app')
