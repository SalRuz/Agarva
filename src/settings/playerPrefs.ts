export type HudSizeMode = 'standard' | 'smaller' | 'evenSmaller';

export interface PlayerPrefs {
  /** Show mass numbers on all cells (self / others / bots) */
  showMass: boolean;
  hudSize: HudSizeMode;
  /** Disable skins for everyone (including self) */
  disableSkins: boolean;
  /** KeyboardEvent.code for split (default Space) */
  keySplit: string;
  /** KeyboardEvent.code for eject; empty = LMB only */
  keyEject: string;
  /** KeyboardEvent.code for freeze (default KeyF) */
  keyFreeze: string;
  /** KeyboardEvent.code for multibox spawn/switch (default Tab) */
  keyMultibox: string;
}

export const DEFAULT_PLAYER_PREFS: PlayerPrefs = {
  showMass: true,
  hudSize: 'standard',
  disableSkins: false,
  keySplit: 'Space',
  keyEject: '',
  keyFreeze: 'KeyF',
  keyMultibox: 'Tab',
};

const STORAGE_KEY = 'agarPlayerPrefs';

export function loadPlayerPrefs(): PlayerPrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_PLAYER_PREFS };
    const parsed = JSON.parse(raw) as Partial<PlayerPrefs> & {
      disableSkinSelf?: boolean;
      disableSkinEveryone?: boolean;
      showMassSelf?: boolean;
      showMassOthers?: boolean;
      showMassBots?: boolean;
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
    showMassSelf?: boolean;
    showMassOthers?: boolean;
    showMassBots?: boolean;
  };
  const base = { ...DEFAULT_PLAYER_PREFS, ...raw };
  const hudSize: HudSizeMode =
    base.hudSize === 'smaller' || base.hudSize === 'evenSmaller' ? base.hudSize : 'standard';
  const disableSkins =
    typeof raw.disableSkins === 'boolean'
      ? raw.disableSkins
      : !!(raw.disableSkinSelf || raw.disableSkinEveryone);
  const showMass =
    typeof raw.showMass === 'boolean'
      ? raw.showMass
      : raw.showMassSelf !== undefined || raw.showMassOthers !== undefined || raw.showMassBots !== undefined
        ? !!(raw.showMassSelf ?? raw.showMassOthers ?? raw.showMassBots)
        : true;
  return {
    showMass,
    hudSize,
    disableSkins,
    keySplit: typeof base.keySplit === 'string' && base.keySplit ? base.keySplit : 'Space',
    keyEject: typeof base.keyEject === 'string' ? base.keyEject : '',
    keyFreeze: typeof base.keyFreeze === 'string' && base.keyFreeze ? base.keyFreeze : 'KeyF',
    keyMultibox:
      typeof base.keyMultibox === 'string' && base.keyMultibox ? base.keyMultibox : 'Tab',
  };
}

/** CSS scale for all gameplay HUD panels */
export function hudSizeScale(mode: HudSizeMode): number {
  if (mode === 'smaller') return 0.85;
  if (mode === 'evenSmaller') return 0.7;
  return 1;
}

/** Mouse button → stored bind code (`Mouse0` = LMB, `Mouse1` = RMB, …) */
export function mouseButtonCode(button: number): string {
  return `Mouse${button}`;
}

export function isMouseBind(code: string): boolean {
  return /^Mouse\d+$/.test(code);
}

export function parseMouseButton(code: string): number | null {
  const m = /^Mouse(\d+)$/.exec(code);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

export function formatKeyCode(code: string): string {
  if (!code) return 'ЛКМ';
  if (code === 'Space') return 'Пробел';
  if (code === 'Tab') return 'Tab';
  if (code === 'Mouse0') return 'ЛКМ';
  if (code === 'Mouse1') return 'ПКМ';
  if (code === 'Mouse2') return 'СКМ';
  if (code === 'Mouse3') return 'Мышь4';
  if (code === 'Mouse4') return 'Мышь5';
  if (code.startsWith('Mouse')) return code.replace('Mouse', 'Мышь');
  if (code.startsWith('Key') && code.length === 4) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  return code;
}
