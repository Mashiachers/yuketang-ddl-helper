import type { LocalOverrides, ReminderConfig, SyncResult, UserSettings } from '../../types';

const PREFIX = 'ykt-ddl:';
const memory = new Map<string, string>();

export const DEFAULT_REMINDERS: ReminderConfig[] = [
  { id: 'three-days', label: '提前 3 天', trigger: '-P3D', enabled: true },
  { id: 'one-day', label: '提前 24 小时', trigger: '-P1D', enabled: true },
  { id: 'three-hours', label: '提前 3 小时', trigger: '-PT3H', enabled: true },
];

export const DEFAULT_SETTINGS: UserSettings = {
  cacheTtlMinutes: 15,
  reminders: DEFAULT_REMINDERS,
  promptPreset: 'weekly-plan',
  customPromptTemplate: '',
  freeTimeNotes: '',
  useDemoMode: false,
  showSubmitted: false,
  showExpired: true,
  maxOverdueDays: 100,
  maxTbdAgeDays: 100,
  theme: 'system',
};

async function read<T>(key: string): Promise<T | undefined> {
  const name = PREFIX + key;
  const area = globalThis.chrome?.storage?.local;
  if (area) return (await area.get(name))[name] as T | undefined;
  let raw: string | null | undefined;
  try { raw = globalThis.localStorage?.getItem(name); } catch { /* Storage unavailable */ }
  raw ??= memory.get(name);
  if (raw === undefined) return;
  try { return JSON.parse(raw) as T; } catch { return undefined; }
}

async function write<T>(key: string, value: T): Promise<void> {
  const name = PREFIX + key;
  const area = globalThis.chrome?.storage?.local;
  if (area) return area.set({ [name]: value });
  const raw = JSON.stringify(value);
  try {
    if (globalThis.localStorage) {
      globalThis.localStorage.setItem(name, raw);
      memory.delete(name);
      return;
    }
  } catch { /* Storage unavailable */ }
  memory.set(name, raw);
}

async function remove(key: string): Promise<void> {
  const name = PREFIX + key;
  const area = globalThis.chrome?.storage?.local;
  if (area) return area.remove(name);
  try { globalThis.localStorage?.removeItem(name); } catch { /* Storage unavailable */ }
  memory.delete(name);
}

export async function getSettings(): Promise<UserSettings> {
  return { ...structuredClone(DEFAULT_SETTINGS), ...(await read<Partial<UserSettings>>('settings')) };
}
export const saveSettings = (settings: UserSettings) => write('settings', settings);
export async function getOverrides(): Promise<LocalOverrides> {
  const stored = await read<Partial<LocalOverrides>>('overrides');
  return {
    completedIds: stored?.completedIds ?? [],
    ignoredIds: stored?.ignoredIds ?? [],
    customDeadlines: stored?.customDeadlines ?? {},
  };
}
export const saveOverrides = (overrides: LocalOverrides) => write('overrides', overrides);
const cacheKey = (origin: string) => 'cache:' + new URL(origin).origin;
const snapshotKey = (origin: string) => 'deadline-snapshot:' + new URL(origin).origin;

export type DeadlineSnapshot = Record<string, number | null>;

export async function getDeadlineSnapshot(origin: string): Promise<DeadlineSnapshot> {
  return (await read<DeadlineSnapshot>(snapshotKey(origin))) ?? {};
}

export const saveDeadlineSnapshot = (origin: string, snapshot: DeadlineSnapshot) =>
  write(snapshotKey(origin), snapshot);

export async function getCachedResult(origin: string, ttlMinutes?: number, now = Date.now()): Promise<SyncResult | null> {
  const result = await read<SyncResult>(cacheKey(origin));
  const ttl = ttlMinutes ?? (await getSettings()).cacheTtlMinutes;
  return result && now >= result.syncedAt && now - result.syncedAt < ttl * 60_000 ? result : null;
}

export const saveCachedResult = (result: SyncResult) => write(cacheKey(result.origin), result);
export const clearCache = (origin: string) => remove(cacheKey(origin));
