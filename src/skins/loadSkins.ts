import { resolveServerUrl } from '../net/MultiplayerClient';

export interface SkinInfo {
  id: string;
  name: string;
  url: string;
  kind?: 'global' | 'shop' | 'level' | 'personal';
  price?: number;
  level?: number;
}

/**
 * Bundled skins from the project-root `skins/` folder.
 * Drop PNG/JPG/WEBP/GIF/SVG there, then restart `npm run dev` / rebuild.
 */
const modules = import.meta.glob('../../skins/*.{png,jpg,jpeg,webp,gif,svg}', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

let customSkins: SkinInfo[] = [];
const CUSTOM_SKIN_MAX_BYTES = 10 * 1024 * 1024;
const PERSONAL_SKIN_IDS = new Set(['1', '2', '3']);
const PERSONAL_SKIN_FALLBACKS: SkinInfo[] = [
  { id: '1', name: 'Добро пожаловать', url: rewardSkin('#38bdf8', '#a7f3d0') },
  { id: '2', name: 'Дай пять', url: rewardSkin('#f59e0b', '#fef3c7', '5') },
  { id: '3', name: 'Ветеран', url: rewardSkin('#a855f7', '#fde68a', '10') },
];

function getSkinBaseName(path: string): string {
  const file = path.split(/[/\\]/).pop() || path;
  return file.replace(/\.[^.]+$/, '');
}

const bundledSkinUrls = new Map(
  Object.entries(modules).map(([path, url]) => [getSkinBaseName(path), url])
);

function isPersonalSkinId(id: string): boolean {
  return PERSONAL_SKIN_IDS.has(getSkinBaseName(id));
}

function getPersonalSkins(): SkinInfo[] {
  return PERSONAL_SKIN_FALLBACKS.map((skin) => ({
    ...skin,
    // A matching file in skins/ takes precedence over the built-in preview.
    url: bundledSkinUrls.get(skin.id) ?? skin.url,
  }));
}

function rewardSkin(from: string, to: string, label?: string) {
  return `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><defs><radialGradient id="g"><stop stop-color="${to}"/><stop offset="1" stop-color="${from}"/></radialGradient></defs><circle cx="128" cy="128" r="124" fill="url(#g)"/><circle cx="88" cy="105" r="12" fill="#111827"/><circle cx="168" cy="105" r="12" fill="#111827"/><path d="M75 150 Q128 205 181 150" fill="none" stroke="#111827" stroke-width="12" stroke-linecap="round"/>${label ? `<text x="128" y="85" text-anchor="middle" font-family="Arial" font-size="34" font-weight="bold" fill="#111827">${label}</text>` : ''}</svg>`
  )}`;
}

function skinApiUrl(path = ''): string {
  const wsUrl = new URL(resolveServerUrl());
  wsUrl.protocol = wsUrl.protocol === 'wss:' ? 'https:' : 'http:';
  wsUrl.pathname = `/api/skins${path}`;
  wsUrl.search = '';
  return wsUrl.toString();
}

export async function loadCustomSkins(): Promise<SkinInfo[]> {
  try {
    const response = await fetch(skinApiUrl(), { cache: 'no-store' });
    if (!response.ok) throw new Error('Не удалось получить список скинов');
    const body = (await response.json()) as { skins?: SkinInfo[] };
    customSkins = (body.skins ?? [])
      .filter((skin) => typeof skin.id === 'string' && typeof skin.name === 'string' && typeof skin.url === 'string')
      .map((skin) => ({ ...skin, url: skin.url.startsWith('http') ? skin.url : skinApiUrl(`/${skin.url.split('/').pop()}`) }));
  } catch {
    // A game server without the optional skin API still works with bundled skins.
    customSkins = [];
  }
  return customSkins;
}

export async function uploadCustomSkin(
  file: File,
  name: string,
  adminName: string,
  password: string,
  kind: 'global' | 'shop' | 'level' = 'global',
  price = 0,
  level = 1
): Promise<void> {
  const normalized = await normalizeSkinImage(file);
  const form = new FormData();
  form.append('file', normalized, `${file.name.replace(/\.[^.]+$/, '') || 'skin'}.webp`);
  form.append('name', name || file.name.replace(/\.[^.]+$/, ''));
  form.append('adminNick', adminName);
  form.append('adminPassword', password);
  form.append('kind', kind);
  form.append('price', String(Math.max(0, Math.floor(price) || 0)));
  form.append('level', String(Math.max(1, Math.floor(level) || 1)));
  const response = await fetch(skinApiUrl(), {
    method: 'POST',
    // Do not manually set Content-Type: the browser supplies the multipart
    // boundary, and Cyrillic credentials stay safely in the request body.
    body: form,
  });
  const body = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) throw new Error(body.error || 'Не удалось загрузить скин');
}

async function normalizeSkinImage(file: File): Promise<File> {
  if (!file.type.startsWith('image/')) throw new Error('Выберите файл изображения');
  const source = await createImageBitmap(file).catch(() => null);
  if (!source) throw new Error('Не удалось прочитать изображение');
  const ratio = Math.min(1, 512 / Math.max(source.width, source.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(source.width * ratio));
  canvas.height = Math.max(1, Math.round(source.height * ratio));
  canvas.getContext('2d')?.drawImage(source, 0, 0, canvas.width, canvas.height);
  source.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', 0.86));
  if (!blob) throw new Error('Не удалось подготовить изображение');
  if (blob.size > CUSTOM_SKIN_MAX_BYTES) throw new Error('Изображение слишком большое после сжатия');
  return new File([blob], 'skin.webp', { type: 'image/webp' });
}

export async function deleteCustomSkin(skin: SkinInfo, adminName: string, password: string): Promise<void> {
  const response = await fetch(skinApiUrl(`/${encodeURIComponent(skin.id)}`), {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ adminNick: adminName, adminPassword: password }),
  });
  const body = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) throw new Error(body.error || 'Не удалось удалить скин');
}

export function listSkins(): SkinInfo[] {
  const bundled = Object.entries(modules)
    .map(([path, url]) => {
      const file = path.split(/[/\\]/).pop() || path;
      const name = getSkinBaseName(file);
      return { id: file, name, url };
    })
    .filter((skin) => !isPersonalSkinId(skin.id));
  const globalCustomSkins = customSkins.filter((skin) => !isPersonalSkinId(skin.id) && (skin.kind ?? 'global') === 'global');
  return [...bundled, ...globalCustomSkins].sort((a, b) => a.name.localeCompare(b.name, 'ru'));
}

export function listPersonalSkins(unlockedIds: readonly string[]): SkinInfo[] {
  const builtIn = getPersonalSkins().filter((skin) => unlockedIds.includes(skin.id));
  const custom = customSkins.filter(
    (skin) => (skin.kind === 'shop' || skin.kind === 'level' || skin.kind === 'personal') && unlockedIds.includes(skin.id)
  );
  return [...builtIn, ...custom];
}

export function listShopSkins(unlockedIds: readonly string[]): SkinInfo[] {
  return customSkins.filter((skin) => skin.kind === 'shop' && !unlockedIds.includes(skin.id));
}

const STORAGE_KEY = 'agarSelectedSkin';

export function loadSelectedSkinId(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function saveSelectedSkinId(id: string | null) {
  try {
    if (!id) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // ignore
  }
}

export function resolveSkinUrl(id: string | null | undefined): string | null {
  if (!id) return null;
  const found = [...listSkins(), ...getPersonalSkins(), ...customSkins].find((s) => s.id === id || s.name === id);
  return found?.url ?? null;
}
