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

export function listSkins(): SkinInfo[] {
  return Object.entries(modules)
    .map(([path, url]) => {
      const file = path.split(/[/\\]/).pop() || path;
      const name = file.replace(/\.[^.]+$/, '');
      return { id: file, name, url };
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
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
