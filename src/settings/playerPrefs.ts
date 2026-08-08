export type HudSizeMode = 'standard' | 'smaller' | 'evenSmaller';
export type MobileControlId = 'joystick' | 'split' | 'eject' | 'chat';
export type MobileControlLayout = Record<MobileControlId, { x: number; y: number; size: number }>;

export interface PlayerPrefs {
  /** Show mass numbers on all cells (self / others / bots) */
  showMass: boolean;
  hudSize: HudSizeMode;
  /** Disable skins for everyone (including self) */
  disableSkins: boolean;
  /** Use the browser/OS cursor instead of the game crosshair. */
  systemCursor: boolean;
  /** Show active quest progress HUD while playing */
  showQuestHud: boolean;
  /** Do not show this account's level to other players. */
  hideLevel: boolean;
  /** KeyboardEvent.code for split (default Space) */
  keySplit: string;
  /** Optional second binding for split */
  keySplitSecondary: string;
  /** KeyboardEvent.code for eject; empty = LMB only */
  keyEject: string;
  /** Optional second binding for eject */
  keyEjectSecondary: string;
  /** KeyboardEvent.code for freeze (default KeyF) */
  keyFreeze: string;
  /** Optional second binding for freeze */
  keyFreezeSecondary: string;
  /** KeyboardEvent.code for multibox spawn/switch (default Tab) */
  keyMultibox: string;
  /** Optional second binding for multibox */
  keyMultiboxSecondary: string;
  /** KeyboardEvent.code for posting map sector to chat (default KeyC) */
  keyCoords: string;
  /** Optional second binding for posting map sector */
  keyCoordsSecondary: string;
  /** Screen-relative mobile control layout (percentages; button size in px). */
  mobileControls: MobileControlLayout;
}

export const DEFAULT_PLAYER_PREFS: PlayerPrefs = {
  showMass: true,
  hudSize: 'standard',
  disableSkins: false,
  systemCursor: false,
  showQuestHud: false,
  hideLevel: false,
  keySplit: 'Space',
  keySplitSecondary: '',
  keyEject: '',
  keyEjectSecondary: '',
  keyFreeze: 'KeyF',
  keyFreezeSecondary: '',
  keyMultibox: 'Tab',
  keyMultiboxSecondary: '',
  keyCoords: 'KeyC',
  keyCoordsSecondary: '',
  mobileControls: {
    joystick: { x: 12, y: 82, size: 108 },
    split: { x: 84, y: 78, size: 66 },
    eject: { x: 72, y: 86, size: 58 },
    chat: { x: 88, y: 58, size: 50 },
  },
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
  const defaultControls = DEFAULT_PLAYER_PREFS.mobileControls;
  const rawControls = (base.mobileControls ?? {}) as Partial<MobileControlLayout>;
  const mobileControls = (Object.keys(defaultControls) as MobileControlId[]).reduce((result, id) => {
    const candidate = rawControls[id];
    const fallback = defaultControls[id];
    result[id] = {
      x: Number.isFinite(candidate?.x) ? Math.max(4, Math.min(96, Number(candidate!.x))) : fallback.x,
      y: Number.isFinite(candidate?.y) ? Math.max(4, Math.min(96, Number(candidate!.y))) : fallback.y,
      size: Number.isFinite(candidate?.size) ? Math.max(40, Math.min(160, Number(candidate!.size))) : fallback.size,
    };
    return result;
  }, {} as MobileControlLayout);
  return {
    showMass,
    hudSize,
    disableSkins,
    systemCursor: typeof base.systemCursor === 'boolean' ? base.systemCursor : false,
    showQuestHud: typeof base.showQuestHud === 'boolean' ? base.showQuestHud : false,
    hideLevel: typeof base.hideLevel === 'boolean' ? base.hideLevel : false,
    keySplit: typeof base.keySplit === 'string' && base.keySplit ? base.keySplit : 'Space',
    keySplitSecondary: typeof base.keySplitSecondary === 'string' ? base.keySplitSecondary : '',
    keyEject: typeof base.keyEject === 'string' ? base.keyEject : '',
    keyEjectSecondary: typeof base.keyEjectSecondary === 'string' ? base.keyEjectSecondary : '',
    keyFreeze: typeof base.keyFreeze === 'string' && base.keyFreeze ? base.keyFreeze : 'KeyF',
    keyFreezeSecondary: typeof base.keyFreezeSecondary === 'string' ? base.keyFreezeSecondary : '',
    keyMultibox:
      typeof base.keyMultibox === 'string' && base.keyMultibox ? base.keyMultibox : 'Tab',
    keyMultiboxSecondary:
      typeof base.keyMultiboxSecondary === 'string' ? base.keyMultiboxSecondary : '',
    keyCoords: typeof base.keyCoords === 'string' && base.keyCoords ? base.keyCoords : 'KeyC',
    keyCoordsSecondary:
      typeof base.keyCoordsSecondary === 'string' ? base.keyCoordsSecondary : '',
    mobileControls,
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
