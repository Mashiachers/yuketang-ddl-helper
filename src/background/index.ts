import type { ExtensionMessage, ExtensionResponse } from '../types';
import { detectPlatform } from '../core/platform/detector';

const LATEST_KEY = 'ykt-ddl:latest-summary';

async function handle(message: ExtensionMessage, sender: chrome.runtime.MessageSender): Promise<ExtensionResponse> {
  switch (message.type) {
    case 'UPDATE_BADGE': {
      if (!Number.isSafeInteger(message.count) || message.count < 0) return { ok: false, error: '无效的 Badge 数量' };
      const origin = detectPlatform(sender.url ?? '')?.origin ?? detectPlatform(message.origin ?? '')?.origin;
      const summary = message.summary;
      await chrome.action.setBadgeBackgroundColor({ color: '#EF4444' });
      await chrome.action.setBadgeText({ text: message.count ? String(message.count) : '' });
      if (summary) {
        const latest = { summary, origin };
        await chrome.storage.local.set({ [LATEST_KEY]: latest, ...(origin ? { [LATEST_KEY + ':' + origin]: latest } : {}) });
      }
      return { ok: true };
    }
    case 'GET_LATEST_SUMMARY': {
      const origin = detectPlatform(message.origin ?? '')?.origin;
      const key = origin ? LATEST_KEY + ':' + origin : LATEST_KEY;
      return { ok: true, ...(await chrome.storage.local.get(key))[key] };
    }
    case 'OPEN_URL': {
      const platform = typeof message.url === 'string' ? detectPlatform(message.url) : null;
      if (!platform) return { ok: false, error: '仅支持 HTTPS 雨课堂链接' };
      await chrome.tabs.create({ url: message.url });
      return { ok: true };
    }
    default:
      return { ok: false, error: '未知消息类型' };
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || !message || typeof message.type !== 'string') return;
  void handle(message, sender).then(sendResponse, () => sendResponse({ ok: false, error: '扩展操作失败' }));
  return true;
});
