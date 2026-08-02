import { resolveServerUrl } from '../net/MultiplayerClient';

export interface SkinInfo {
  id: string;
  name: string;
  url: string;
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

export async function uploadCustomSkin(file: File, name: string, adminName: string, password: string): Promise<void> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
    throw new Error('Разрешены только PNG, JPG и WEBP');
  }
  if (file.size > CUSTOM_SKIN_MAX_BYTES) throw new Error('Файл больше 10 МБ');
  const form = new FormData();
  form.append('file', file, file.name);
  form.append('name', name || file.name.replace(/\.[^.]+$/, ''));
  form.append('adminNick', adminName);
  form.append('adminPassword', password);
  const response = await fetch(skinApiUrl(), {
    method: 'POST',
    // Do not manually set Content-Type: the browser supplies the multipart
    // boundary, and Cyrillic credentials stay safely in the request body.
    body: form,
  });
  const body = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) throw new Error(body.error || 'Не удалось загрузить скин');
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
      const name = file.replace(/\.[^.]+$/, '');
      return { id: file, name, url };
    })
  return [...bundled, ...customSkins].sort((a, b) => a.name.localeCompare(b.name, 'ru'));
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
  const found = listSkins().find((s) => s.id === id || s.name === id);
  return found?.url ?? null;
}
