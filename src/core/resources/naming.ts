const forbidden = /[<>:"/\\|?*\p{Cc}\u202a-\u202e\u2066-\u2069]/gu;
const device = /^(?:CON|PRN|AUX|NUL|CONIN\$|CONOUT\$|COM[1-9¹²³]|LPT[1-9¹²³]) *(?:\.|$)/i;
const maxBytes = 240;
const encoder = new TextEncoder();

const ACTIVE_EXTENSIONS = new Set([
  '.exe', '.bat', '.cmd', '.com', '.msi', '.msp', '.ps1', '.psm1', '.vbs', '.vbe',
  '.js', '.jse', '.mjs', '.cjs', '.wsf', '.wsh', '.scr', '.pif', '.hta', '.lnk',
  '.reg', '.sh', '.bash', '.zsh', '.command', '.app', '.jar', '.html', '.htm',
  '.xhtml', '.svg', '.svgz', '.mhtml', '.swf', '.dll', '.cpl', '.inf',
]);

export function redactCredentialText(value: string): string {
  return value.replace(/\b(?:cookie|set-cookie|authorization|proxy-authorization)\s*:\s*[^\r\n]*/gi, '[已省略凭据]')
    .replace(/\b(?:csrf[-_]?token|session[-_]?id|(?:access|refresh|auth)[-_]?token|token|password|secret|jwt|api[-_]?key|student[-_]?id|user[-_]?id)\s*[=:]\s*(?:"[^"]*"|'[^']*'|[^&\s;,]+)/gi,
      '[已省略凭据]')
    .replace(/(?:学号|学生证号)\s*[:：=]?\s*[A-Za-z0-9._-]{3,}/gi, '[已省略凭据]')
    .replace(/\bBearer\s+[a-z\d._~+\/=-]+/gi, '[已省略凭据]');
}

export function isActiveFileExtension(filename: string): boolean {
  const [, ext] = splitExtension(filename);
  return ACTIVE_EXTENSIONS.has(ext.toLowerCase());
}

export function neutralizeActiveExtension(filename: string): string {
  const safe = sanitizeFilename(filename);
  if (!isActiveFileExtension(safe)) return safe;
  return fit(safe + '.download');
}

function truncate(value: string, max: number): string {
  let end = 0;
  let left = max;
  for (const character of value) {
    left -= encoder.encode(character).length;
    if (left < 0) break;
    end += character.length;
  }
  return value.slice(0, end);
}

function splitExtension(name: string): [string, string] {
  const dot = name.lastIndexOf('.');
  return dot > 0 && encoder.encode(name.slice(dot)).length <= 32
    ? [name.slice(0, dot), name.slice(dot)]
    : [name, ''];
}

function fit(name: string, suffix = ''): string {
  const [stem, extension] = splitExtension(name);
  return truncate(stem, maxBytes - encoder.encode(suffix + extension).length)
    .replace(/[ .]+$/u, '') + suffix + extension;
}

export function sanitizeFilename(name: string, fallback = 'file'): string {
  const clean = (value: string) => redactCredentialText(value).toWellFormed().normalize('NFC')
    .replace(/(?:https?:)?\/\/[^/\s@]+@/gi, '//')
    .replace(/^[A-Za-z]:/, '').replace(forbidden, '_').trim().replace(/^\.+|[ .]+$/gu, '');
  const safe = clean(name) || clean(fallback) || 'file';
  const fitted = fit(safe);
  return device.test(fitted) ? fit('_' + safe) : fitted;
}

export function sanitizePathSegment(segment: string, fallback = 'folder'): string {
  return sanitizeFilename(segment, fallback);
}

export function deduplicateFilename(filename: string, usedNames: Set<string>): string {
  const name = sanitizeFilename(filename);
  const taken = new Set(Array.from(usedNames, value => value.normalize('NFC').toLowerCase()));
  let candidate = name;
  for (let count = 2; taken.has(candidate.toLowerCase()); count++) {
    candidate = fit(name, ' (' + count + ')');
  }
  usedNames.add(candidate);
  return candidate;
}

export function buildSafeRelativePath(segments: readonly string[]): string {
  if (segments.length === 0 || segments.some(segment =>
    !segment || segment === '.' || segment === '..' || /^\s/u.test(segment) ||
    /[ .]$/u.test(segment) || segment.replace(forbidden, '') !== segment ||
    !segment.isWellFormed() || device.test(segment) || encoder.encode(segment).length > 255
  )) {
    throw new Error('Unsafe relative path');
  }
  return segments.join('/');
}
