import type { PlatformInfo } from '../../types';

const variants: Record<string, Pick<PlatformInfo, 'variant' | 'label'>> = {
  'www.yuketang.cn': { variant: 'main', label: '雨课堂' },
  'yuketang.cn': { variant: 'main', label: '雨课堂' },
  'changjiang.yuketang.cn': { variant: 'changjiang', label: '长江雨课堂' },
  'pro.yuketang.cn': { variant: 'hetang', label: '荷塘雨课堂' },
  'huanghe.yuketang.cn': { variant: 'huanghe', label: '黄河雨课堂' },
};

export function isYuketangHost(hostname: string): boolean {
  return /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)*yuketang\.cn$/i.test(hostname);
}

export function parseCookies(cookie: string): Record<string, string> {
  const result: Record<string, string> = Object.create(null);
  for (const entry of cookie.split(';')) {
    const split = entry.indexOf('=');
    if (split < 1) continue;
    const key = entry.slice(0, split).trim();
    const value = entry.slice(split + 1).trim();
    if (Object.hasOwn(result, key)) continue;
    try { result[key] = decodeURIComponent(value); }
    catch { result[key] = value; }
  }
  return result;
}

export function detectPlatform(input: string | URL, cookie = ''): PlatformInfo | null {
  try {
    const url = new URL(input);
    if (url.protocol !== 'https:' || !isYuketangHost(url.hostname) || url.username || url.password) return null;
    const cookies = parseCookies(cookie);
    return {
      origin: url.origin,
      host: url.hostname,
      ...(variants[url.hostname] ?? { variant: 'custom', label: url.hostname }),
      xtbz: cookies.xtbz || 'ykt',
      universityId: cookies.university_id || cookies['university-id'],
    };
  } catch {
    return null;
  }
}

export function buildRequestHeaders(platform: PlatformInfo, cookie = '', classroomId?: string): Headers {
  const headers = new Headers({ Accept: 'application/json' });
  const cookies = parseCookies(cookie);
  const candidates: [string, string | undefined][] = [
    ['x-csrftoken', cookies.csrftoken],
    ['xtbz', cookies.xtbz || platform.xtbz],
    ['university-id', platform.universityId],
    ['classroom-id', classroomId],
  ];
  for (const [name, value] of candidates) {
    if (value && /^[\x20-\x7e]+$/.test(value)) headers.set(name, value);
  }
  return headers;
}
