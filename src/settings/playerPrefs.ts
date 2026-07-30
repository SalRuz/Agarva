export type HudSizeMode = 'standard' | 'smaller' | 'evenSmaller';

export interface PlayerPrefs {
  showMassSelf: boolean;
  showMassOthers: boolean;
  showMassBots: boolean;
  hudSize: HudSizeMode;
  /** Disable skins for everyone (including self) */
  disableSkins: boolean;
  /** KeyboardEvent.code for split (default Space) */
  keySplit: string;
  /** KeyboardEvent.code for eject; empty = LMB only */
  keyEject: string;
  /** KeyboardEvent.code for freeze (default KeyF) */
  keyFreeze: string;
}

export const DEFAULT_PLAYER_PREFS: PlayerPrefs = {
  showMassSelf: true,
  showMassOthers: true,
  showMassBots: true,
  hudSize: 'standard',
  disableSkins: false,
  keySplit: 'Space',
  keyEject: '',
  keyFreeze: 'KeyF',
};

const STORAGE_KEY = 'agarPlayerPrefs';

export function loadPlayerPrefs(): PlayerPrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_PLAYER_PREFS };
    const parsed = JSON.parse(raw) as Partial<PlayerPrefs> & {
      disableSkinSelf?: boolean;
      disableSkinEveryone?: boolean;
    };
    return sanitizePlayerPrefs(parsed);
  } catch {
    return { ...DEFAULT_PLAYER_PREFS };
  }
}

export function savePlayerPrefs(prefs: PlayerPrefs): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sanitizePlayerPrefs(prefs)));
  } catch {
    // ignore
  }
}

export function sanitizePlayerPrefs(input: Partial<PlayerPrefs> | null | undefined): PlayerPrefs {
  const raw = (input ?? {}) as Partial<PlayerPrefs> & {
    disableSkinSelf?: boolean;
    disableSkinEveryone?: boolean;
  };
  const base = { ...DEFAULT_PLAYER_PREFS, ...raw };
  const hudSize: HudSizeMode =
    base.hudSize === 'smaller' || base.hudSize === 'evenSmaller' ? base.hudSize : 'standard';
  const disableSkins =
    typeof raw.disableSkins === 'boolean'
      ? raw.disableSkins
      : !!(raw.disableSkinSelf || raw.disableSkinEveryone);
  return {
    showMassSelf: !!base.showMassSelf,
    showMassOthers: !!base.showMassOthers,
    showMassBots: !!base.showMassBots,
    hudSize,
    disableSkins,
    keySplit: typeof base.keySplit === 'string' && base.keySplit ? base.keySplit : 'Space',
    keyEject: typeof base.keyEject === 'string' ? base.keyEject : '',
    keyFreeze: typeof base.keyFreeze === 'string' && base.keyFreeze ? base.keyFreeze : 'KeyF',
  };
}

/** CSS scale for all gameplay HUD panels */
export function hudSizeScale(mode: HudSizeMode): number {
  if (mode === 'smaller') return 0.85;
  if (mode === 'evenSmaller') return 0.7;
  return 1;
}

export function formatKeyCode(code: string): string {
  if (!code) return 'ЛКМ';
  if (code === 'Space') return 'Пробел';
  if (code.startsWith('Key') && code.length === 4) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  return code;
}
