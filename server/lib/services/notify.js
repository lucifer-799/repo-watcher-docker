import { formatDateTime } from '../utils/datetime.js';

/**
 * 根据检测结果构建通知标题与正文（Markdown）。
 * MagicPush 与自定义通知共用同一套文案，避免重复。
 * @param {Object} result 检测结果
 * @param {Object} config 配置对象
 * @returns {{title: string, content: string, formattedTime: string}}
 */
function buildMessage(result, config) {
  const formattedTime = formatDateTime(result.latestDate, config?.tz);
  let title, content;

  // 根据 platform 生成不同的通知消息
  if (result.source === 'release') {
    const platformLabel = {
      github: 'GitHub',
      gitee: 'Gitee',
      gitlab: 'GitLab',
      gitcode: 'GitCode',
    }[result.platform] || result.platform;

    title = `${platformLabel} Release 更新 - ${result.repo}`;
    content = `- **仓库**：[${result.repo}](${result.url})\n` +
              `- **版本**：\`${result.latestTag}\`\n` +
              (result.releaseName ? `- **名称**：${result.releaseName}\n` : '') +
              `- **上次版本**：${result.previousTag || '无'}\n` +
              `- **时间**：${formattedTime}`;
    if (result.releaseUrl) {
      content += `\n- [查看 Release](${result.releaseUrl})`;
    }
  } else if (result.platform === 'cnb') {
    // CNB 与其余平台一致，监控的是代码提交（SHA），而非构建记录
    title = `CNB 仓库更新 - ${result.repo}`;
    content = `- **仓库**：[${result.repo}](${result.url})\n` +
              `- **分支**：${result.branch || '-'}\n` +
              `- **SHA**：\`${result.latestSha}\`\n` +
              `- **Commit**：${result.latestMessage || result.commitMessage || '无'}\n` +
              `- **时间**：${formattedTime}`;
  } else if (result.platform === 'gitee') {
    title = `Gitee 仓库更新 - ${result.repo}`;
    content = `- **仓库**：[${result.repo}](${result.url})\n` +
              `- **SHA**：\`${result.latestSha}\`\n` +
              `- **Commit**：${result.commitMessage || '无'}\n` +
              `- **时间**：${formattedTime}`;
  } else if (result.platform === 'gitlab') {
    title = `GitLab 仓库更新 - ${result.repo}`;
    content = `- **仓库**：[${result.repo}](${result.url})\n` +
              `- **SHA**：\`${result.latestSha}\`\n` +
              `- **Commit**：${result.commitMessage || '无'}\n` +
              `- **时间**：${formattedTime}`;
  } else if (result.platform === 'gitcode') {
    title = `GitCode 仓库更新 - ${result.repo}`;
    content = `- **仓库**：[${result.repo}](${result.url})\n` +
              `- **SHA**：\`${result.latestSha}\`\n` +
              `- **Commit**：${result.commitMessage || '无'}\n` +
              `- **时间**：${formattedTime}`;
  } else {
    title = `GitHub 仓库更新 - ${result.repo}`;
    content = `- **仓库**：[${result.repo}](${result.url})\n` +
              `- **SHA**：\`${result.latestSha}\`\n` +
              `- **Commit**：${result.commitMessage || '无'}\n` +
              `- **时间**：${formattedTime}`;
  }

  return { title, content, formattedTime };
}

/**
 * 模板渲染：将 {{key}} 形式的占位符替换为上下文中的值（缺失则为空串）。
 * 支持点路径，如 {{result.repo}}。
 * @param {string} str 含占位符的模板
 * @param {Object} ctx 渲染上下文
 * @returns {string}
 */
function renderTemplate(str, ctx) {
  if (!str || typeof str !== 'string') return str;
  return str.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, key) => {
    // 安全取值：逐段校验 own-property 并拒绝原型链危险键，
    // 防止 {{__proto__.x}} / {{constructor.name}} 之类触达原型链（原型污染/信息泄露）。
    let cur = ctx;
    for (const k of key.split('.')) {
      if (k === '__proto__' || k === 'constructor' || k === 'prototype') return '';
      if (cur == null || typeof cur !== 'object' || !Object.prototype.hasOwnProperty.call(cur, k)) return '';
      cur = cur[k];
    }
    return cur == null ? '' : String(cur);
  });
}

/**
 * MagicPush 通知
 * @param {Object} result 检测结果
 * @param {Object} config 配置对象
 * @returns {Promise<{ok: boolean, error?: string}>}
 */
export async function sendMagicPushNotification(result, config) {
  try {
    const { title, content } = buildMessage(result, config);

    const response = await fetch(config?.magicpush?.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config?.magicpush?.token}`
      },
      body: JSON.stringify({
        title: title,
        content: content,
        type: 'markdown'
      })
    });

    if (response.ok) {
      console.log('MagicPush 通知发送成功');
      return { ok: true };
    } else {
      const error = await response.text();
      console.error('MagicPush 通知发送失败:', error);
      return { ok: false, error };
    }
  } catch (error) {
    console.error('MagicPush 通知异常:', error);
    return { ok: false, error: String(error) };
  }
}

/**
 * 自定义通知：用户自定 URL / 方法 / 请求头 / 请求体。
 * 请求头为 JSON 字符串（支持模板），请求体支持 {{变量}} 占位符。
 * 与 MagicPush 完全独立，互不影响。
 * @param {Object} result 检测结果
 * @param {Object} config 配置对象
 * @returns {Promise<{ok: boolean, error?: string}>}
 */
export async function sendCustomNotification(result, config) {
  const custom = config?.custom;
  if (!custom || custom.enabled !== true) {
    console.log('自定义通知未启用，跳过');
    return { ok: false, error: '未启用' };
  }
  if (!custom.url) {
    console.log('自定义通知未配置 URL，跳过');
    return { ok: false, error: '未配置 URL' };
  }

  try {
    const msg = buildMessage(result, config);
    const ctx = {
      ...msg,
      repo: result.repo,
      url: result.url,
      latestTag: result.latestTag,
      latestSha: result.latestSha,
      latestMessage: result.latestMessage || result.commitMessage || '',
      branch: result.branch || '',
      platform: result.platform,
      source: result.source || '',
      releaseName: result.releaseName || '',
      releaseUrl: result.releaseUrl || '',
      latestDate: result.latestDate || '',
    };

    const url = renderTemplate(custom.url, ctx);
    const method = String(custom.method || 'POST').toUpperCase();

    let headers = {};
    if (custom.headers) {
      try {
        const parsed = JSON.parse(renderTemplate(custom.headers, ctx));
        if (parsed && typeof parsed === 'object') headers = parsed;
      } catch (e) {
        console.error('自定义通知请求头不是合法 JSON，已忽略:', e.message);
      }
    }

    const init = { method, headers };
    const hasBody = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);
    if (custom.body && hasBody) {
      init.body = renderTemplate(custom.body, ctx);
    }

    const response = await fetch(url, init);

    if (response.ok) {
      console.log('自定义通知发送成功');
      return { ok: true };
    } else {
      const error = await response.text();
      console.error('自定义通知发送失败:', error);
      return { ok: false, error };
    }
  } catch (error) {
    console.error('自定义通知异常:', error);
    return { ok: false, error: String(error) };
  }
}

/**
 * 主通知函数：并行调用所有已启用且已配置的通知渠道，互不影响。
 * @param {Object} result 检测结果
 * @param {Object} config 配置对象
 */
export async function notify(result, config) {
  // 根据平台类型输出不同的日志
  if (result.source === 'release') {
    console.log(`检测到 ${result.platform} Release 更新: ${result.repo}`);
    console.log(`最新版本: ${result.latestTag}, 上次版本: ${result.previousTag || '无'}, 发布时间: ${result.latestDate}`);
  } else if (result.platform === 'cnb') {
    console.log(`检测到 CNB 仓库更新: ${result.repo}`);
    console.log(`最新 SHA: ${result.latestSha}, 更新时间: ${result.latestDate}`);
  } else if (result.platform === 'gitee') {
    console.log(`检测到 Gitee 仓库更新: ${result.repo}`);
    console.log(`最新 SHA: ${result.latestSha}, 更新时间: ${result.latestDate}`);
  } else if (result.platform === 'gitlab') {
    console.log(`检测到 GitLab 仓库更新: ${result.repo}`);
    console.log(`最新 SHA: ${result.latestSha}, 更新时间: ${result.latestDate}`);
  } else if (result.platform === 'gitcode') {
    console.log(`检测到 GitCode 仓库更新: ${result.repo}`);
    console.log(`最新 SHA: ${result.latestSha}, 更新时间: ${result.latestDate}`);
  } else {
    console.log(`检测到 GitHub 仓库更新: ${result.repo}`);
    console.log(`最新 SHA: ${result.latestSha}, 更新时间: ${result.latestDate}`);
  }

  // 收集所有需要调用的渠道任务，并行执行、互不阻塞
  const tasks = [];

  if (config?.magicpush?.enabled === true && config?.magicpush?.url && config?.magicpush?.token) {
    tasks.push(sendMagicPushNotification(result, config));
  } else {
    console.log('未启用/配置 MagicPush 通知');
  }

  if (config?.custom?.enabled === true && config?.custom?.url) {
    tasks.push(sendCustomNotification(result, config));
  } else {
    console.log('未启用/配置自定义通知');
  }

  await Promise.allSettled(tasks);
}
