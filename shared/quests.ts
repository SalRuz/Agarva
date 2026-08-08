/** Quest / XP / Agarviki progression for Agarva profiles. */

export const XP_PER_LEVEL = 100;
export const XP_PER_QUEST = 10;
/** Agarviki are awarded by level milestones, never by quest completion. */
export const AGARVIKI_PER_QUEST = 0;
export const AGARVIKI_PER_LEVEL = 10;

export const LEVEL_SKIN_REWARDS: Record<number, { id: string; name: string }> = {
  1: { id: '1', name: 'Добро пожаловать' },
  5: { id: '2', name: 'Дай пять' },
  10: { id: '3', name: 'Ветеран' },
};

export type QuestTaskId =
  | 'mass'
  | 'survive'
  | 'top'
  | 'kills'
  | 'viruses'
  | 'splits'
  | 'massNoVirus';

export const QUEST_TASK_IDS: readonly QuestTaskId[] = [
  'mass',
  'survive',
  'top',
  'kills',
  'viruses',
  'splits',
  'massNoVirus',
] as const;

export interface QuestTaskDef {
  id: QuestTaskId;
  title: string;
  /** Base requirement at the start of progression */
  base: number;
  /** Added each time this task upgrades */
  step: number;
  /** How progress is measured */
  unit: 'mass' | 'minutes' | 'count';
  /** Progress only counts from a fresh life / zero start */
  requiresFreshStart?: boolean;
  /** Clear Russian condition shown in the menu and in-game HUD. */
  condition: string;
  /** Backward-compatible UI hint; mirrors condition. */
  hint?: string;
}

export const QUEST_DEFS: Record<QuestTaskId, QuestTaskDef> = {
  mass: {
    id: 'mass',
    title: 'Набрать массу',
    base: 5000,
    step: 1000,
    unit: 'mass',
    requiresFreshStart: true,
    condition: 'Старт с нуля (с новой жизни)',
    hint: 'Старт с нуля (с новой жизни)',
  },
  survive: {
    id: 'survive',
    title: 'Продержаться в игре',
    base: 20,
    step: 1,
    unit: 'minutes',
    condition: 'Просто продержитесь в игре',
    hint: 'Просто продержитесь в игре',
  },
  top: {
    id: 'top',
    title: 'Продержаться на топе',
    base: 15,
    step: 1,
    unit: 'minutes',
    requiresFreshStart: true,
    condition: 'Топ-10; при вылете или смерти — заново',
    hint: 'Топ-10; при вылете или смерти — заново',
  },
  kills: {
    id: 'kills',
    title: 'Победить игроков',
    base: 3,
    step: 1,
    unit: 'count',
    condition: 'Поглощайте игроков',
  },
  viruses: {
    id: 'viruses',
    title: 'Собрать колючки',
    base: 30,
    step: 2,
    unit: 'count',
    condition: 'Поглощайте колючки',
  },
  splits: {
    id: 'splits',
    title: 'Сделать сплиты',
    base: 30,
    step: 10,
    unit: 'count',
    condition: 'Нажимайте пробел, когда можно сплититься',
  },
  massNoVirus: {
    id: 'massNoVirus',
    title: 'Набрать массу без касания колючек',
    base: 5000,
    step: 1000,
    unit: 'mass',
    requiresFreshStart: true,
    condition: 'Старт с нуля (с новой жизни), не касаясь колючек',
    hint: 'Старт с нуля (с новой жизни), не касаясь колючек',
  },
};

export interface QuestTaskState {
  completedTotal: number;
  /** Completions since last requirement upgrade */
  sinceUpgrade: number;
  /** Current required value for this task */
  requirement: number;
}

export interface QuestProgress {
  xp: number;
  agarviki: number;
  tasks: Record<QuestTaskId, QuestTaskState>;
  /** Remaining task ids in the current circle (unique, shuffle bag) */
  cycleBag: QuestTaskId[];
  /** Active task in the circle */
  currentTaskId: QuestTaskId;
  /** Progress toward current task requirement (same units as requirement) */
  currentProgress: number;
  /** Level milestones already paid out; prevents duplicate rewards. */
  claimedLevelRewards: number[];
  /** Skin ids received from level milestones. */
  unlockedSkinIds: string[];
  /** Server-persisted level rewards that still need a UI congratulations. */
  pendingLevelRewards?: number[];
}

export interface QuestPublicView {
  level: number;
  xp: number;
  xpIntoLevel: number;
  xpPerLevel: number;
  agarviki: number;
  taskId: string;
  title: string;
  progress: number;
  requirement: number;
  unit: QuestTaskDef['unit'];
  /** Server-measured time to completion for minute-based tasks. */
  remainingMs?: number;
  /** The client may animate the countdown only while this is true. */
  timeRunning?: boolean;
  /** Condition that must be met for quest progress to count. */
  condition: string;
  hint?: string;
  /** This tab mirrors the account quest, but cannot advance it. */
  followerOnly?: boolean;
  claimedLevelRewards: number[];
  unlockedSkinIds: string[];
  /** Server-persisted level rewards that still need a UI congratulations. */
  pendingLevelRewards?: number[];
}

function emptyTask(def: QuestTaskDef): QuestTaskState {
  return { completedTotal: 0, sinceUpgrade: 0, requirement: def.base };
}

export function levelFromXp(xp: number): number {
  return Math.floor(Math.max(0, xp) / XP_PER_LEVEL);
}

export function xpIntoLevel(xp: number): number {
  return Math.max(0, xp) % XP_PER_LEVEL;
}

/** N_step = 3 + floor(level / 50) */
export function upgradePeriodForLevel(level: number): number {
  return 3 + Math.floor(Math.max(0, level) / 50);
}

export function shuffleQuestCycle(rng: () => number = Math.random): QuestTaskId[] {
  const bag = [...QUEST_TASK_IDS];
  for (let i = bag.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = bag[i];
    bag[i] = bag[j];
    bag[j] = tmp;
  }
  return bag;
}

export function createDefaultQuestProgress(rng: () => number = Math.random): QuestProgress {
  const tasks = {} as Record<QuestTaskId, QuestTaskState>;
  for (const id of QUEST_TASK_IDS) tasks[id] = emptyTask(QUEST_DEFS[id]);
  const cycleBag = shuffleQuestCycle(rng);
  return {
    xp: 0,
    agarviki: 0,
    tasks,
    cycleBag: cycleBag.slice(1),
    currentTaskId: cycleBag[0],
    currentProgress: 0,
    claimedLevelRewards: [],
    unlockedSkinIds: [],
  };
}

export function sanitizeQuestProgress(raw: unknown): QuestProgress {
  const base = createDefaultQuestProgress();
  if (!raw || typeof raw !== 'object') return base;
  const src = raw as Partial<QuestProgress>;
  const xp = Math.max(0, Math.floor(Number(src.xp) || 0));
  const agarviki = Math.max(0, Math.floor(Number(src.agarviki) || 0));
  const tasks = { ...base.tasks };
  for (const id of QUEST_TASK_IDS) {
    const t = (src.tasks as Record<string, QuestTaskState> | undefined)?.[id];
    const def = QUEST_DEFS[id];
    if (!t || typeof t !== 'object') continue;
    tasks[id] = {
      completedTotal: Math.max(0, Math.floor(Number(t.completedTotal) || 0)),
      sinceUpgrade: Math.max(0, Math.floor(Number(t.sinceUpgrade) || 0)),
      requirement: Math.max(def.base, Math.floor(Number(t.requirement) || def.base)),
    };
  }
  let cycleBag = Array.isArray(src.cycleBag)
    ? src.cycleBag.filter((id): id is QuestTaskId => QUEST_TASK_IDS.includes(id as QuestTaskId))
    : base.cycleBag;
  let currentTaskId = QUEST_TASK_IDS.includes(src.currentTaskId as QuestTaskId)
    ? (src.currentTaskId as QuestTaskId)
    : base.currentTaskId;
  // Ensure current is not duplicated in bag
  cycleBag = cycleBag.filter((id) => id !== currentTaskId);
  const missing = QUEST_TASK_IDS.filter((id) => id !== currentTaskId && !cycleBag.includes(id));
  cycleBag = [...cycleBag, ...missing];
  return {
    xp,
    agarviki,
    tasks,
    cycleBag,
    currentTaskId,
    currentProgress: Math.max(0, Number(src.currentProgress) || 0),
    claimedLevelRewards: Array.isArray(src.claimedLevelRewards)
      ? [...new Set(src.claimedLevelRewards.map((level) => Math.floor(Number(level))).filter((level) => level > 0))]
      : [],
    unlockedSkinIds: Array.isArray(src.unlockedSkinIds)
      ? [...new Set(src.unlockedSkinIds.filter((id): id is string => typeof id === 'string' && id.trim().length > 0))]
      : [],
  };
}

export function toQuestPublicView(
  progress: QuestProgress,
  opts?: { followerOnly?: boolean; timeRunning?: boolean; pendingLevelRewards?: number[] }
): QuestPublicView {
  const def = QUEST_DEFS[progress.currentTaskId];
  const task = progress.tasks[progress.currentTaskId];
  const xp = progress.xp;
  return {
    level: levelFromXp(xp),
    xp,
    xpIntoLevel: xpIntoLevel(xp),
    xpPerLevel: XP_PER_LEVEL,
    agarviki: progress.agarviki,
    taskId: progress.currentTaskId,
    title: def.title,
    progress: Math.min(task.requirement, progress.currentProgress),
    requirement: task.requirement,
    unit: def.unit,
    remainingMs:
      def.unit === 'minutes'
        ? Math.max(0, Math.ceil((task.requirement - Math.min(task.requirement, progress.currentProgress)) * 60_000))
        : undefined,
    timeRunning: def.unit === 'minutes' && opts?.timeRunning ? true : undefined,
    condition: def.condition,
    hint: def.hint,
    followerOnly: opts?.followerOnly || undefined,
    claimedLevelRewards: progress.claimedLevelRewards,
    unlockedSkinIds: progress.unlockedSkinIds,
    pendingLevelRewards: opts?.pendingLevelRewards,
  };
}

export function formatQuestRequirement(value: number, unit: QuestTaskDef['unit']): string {
  if (unit === 'minutes') return `${Math.round(value)} мин`;
  if (unit === 'mass') return `${Math.round(value).toLocaleString('ru-RU')} массы`;
  return `${Math.round(value)}`;
}

export function formatQuestProgressLine(view: QuestPublicView, elapsedMs = 0): string {
  if (view.followerOnly) return 'Задание засчитывается только на основной вкладке';
  const cur = formatQuestRequirement(view.progress, view.unit);
  const need = formatQuestRequirement(view.requirement, view.unit);
  const remaining =
    view.unit === 'minutes' && view.remainingMs !== undefined && view.timeRunning
      ? ` · Осталось: ${formatQuestCountdown(Math.max(0, view.remainingMs - elapsedMs))}`
      : view.unit === 'minutes' && view.remainingMs !== undefined
        ? ` · Осталось: ${formatQuestCountdown(view.remainingMs)}`
        : '';
  return `${view.title}: ${cur} / ${need}${remaining} · Условие: ${view.condition}`;
}

export function formatQuestCountdown(remainingMs: number): string {
  const totalSeconds = Math.ceil(Math.max(0, remainingMs) / 1_000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/**
 * Apply a measured progress value for the active task (absolute for this life/session
 * contribution is merged by caller via Math.max on currentProgress).
 * Returns whether the task completed (and progress was advanced).
 */
export function applyQuestProgressValue(
  progress: QuestProgress,
  value: number,
  extraLevelSkins: Record<number, readonly { id: string; name: string }[]> = {}
): { progress: QuestProgress; completed: boolean; levelRewards: number[] } {
  const next = sanitizeQuestProgress(progress);
  const taskId = next.currentTaskId;
  const task = next.tasks[taskId];
  next.currentProgress = Math.max(next.currentProgress, value);
  if (next.currentProgress < task.requirement) {
    return { progress: next, completed: false, levelRewards: [] };
  }

  // Complete
  next.xp += XP_PER_QUEST;
  next.agarviki += AGARVIKI_PER_QUEST;
  const currentLevel = levelFromXp(next.xp);
  const levelRewards: number[] = [];
  // Also recover unclaimed older milestones once the player next earns XP.
  // This safely migrates existing profiles without allowing a second claim.
  for (let level = 1; level <= currentLevel; level++) {
    if (next.claimedLevelRewards.includes(level)) continue;
    next.claimedLevelRewards.push(level);
    next.agarviki += AGARVIKI_PER_LEVEL;
    levelRewards.push(level);
    for (const skin of [LEVEL_SKIN_REWARDS[level], ...(extraLevelSkins[level] ?? [])]) {
      if (skin && !next.unlockedSkinIds.includes(skin.id)) next.unlockedSkinIds.push(skin.id);
    }
  }
  task.completedTotal += 1;
  task.sinceUpgrade += 1;
  const level = levelFromXp(next.xp);
  const period = upgradePeriodForLevel(level);
  if (task.sinceUpgrade >= period) {
    task.requirement += QUEST_DEFS[taskId].step;
    task.sinceUpgrade = 0;
  }

  // Draw next from cycle bag; reshuffle a full unique circle when empty.
  let bag = [...next.cycleBag];
  if (bag.length === 0) {
    bag = shuffleQuestCycle();
  }
  next.currentTaskId = bag[0];
  next.cycleBag = bag.slice(1);
  next.currentProgress = 0;
  return { progress: next, completed: true, levelRewards };
}

/** Runtime counters for one life / play session feeding the quest evaluator. */
export interface QuestRunStats {
  /** This life began after the quest was assigned, from a normal spawn mass. */
  startedFromZero: boolean;
  peakMass: number;
  surviveMs: number;
  topMs: number;
  /** True while currently ranked 1–10; leaving top-10 clears topMs. */
  inTop10: boolean;
  kills: number;
  viruses: number;
  splits: number;
  peakMassNoVirus: number;
  touchedVirus: boolean;
}

export function emptyQuestRunStats(): QuestRunStats {
  return {
    startedFromZero: false,
    peakMass: 0,
    surviveMs: 0,
    topMs: 0,
    inTop10: false,
    kills: 0,
    viruses: 0,
    splits: 0,
    peakMassNoVirus: 0,
    touchedVirus: false,
  };
}

export function questValueFromRun(taskId: QuestTaskId, run: QuestRunStats): number {
  switch (taskId) {
    case 'mass':
      return run.startedFromZero ? run.peakMass : 0;
    case 'survive':
      return run.surviveMs / 60_000;
    case 'top':
      return run.topMs / 60_000;
    case 'kills':
      return run.kills;
    case 'viruses':
      return run.viruses;
    case 'splits':
      return run.splits;
    case 'massNoVirus':
      return run.startedFromZero && !run.touchedVirus ? run.peakMassNoVirus : 0;
    default:
      return 0;
  }
}
