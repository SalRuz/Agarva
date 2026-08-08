import { readFileSync, existsSync } from 'node:fs';
import { copyFile, mkdir, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import type { GameplayConfig } from '../shared/gameConfig';
import type { QuestProgress } from '../shared/quests';
import { sanitizeQuestProgress, createDefaultQuestProgress } from '../shared/quests';

export type FightMode = 'soloFight' | 'duoFight' | 'trioFight';
export type TopMode = 'classic' | FightMode;
export interface ClassicRecord {
  deviceId: string;
  name: string;
  mass: number;
  skin?: string;
  updatedAt: number;
}

/** Mirror of client player prefs — kept loose so server does not import React client code. */
export type StoredPlayerPrefs = Record<string, unknown>;

export interface PlayerProfile {
  lastNick: string;
  skinId?: string;
  prefs?: StoredPlayerPrefs;
  fingerprint?: string;
  /** Registered account login (latin+digits), locked to this device */
  accountLogin?: string;
  /** XP / Agarviki / quest circle progress */
  quests?: QuestProgress;
  /** Server-authored rewards awaiting display; removed only after the client acknowledges them. */
  pendingLevelRewards?: number[];
  updatedAt: number;
}

export interface AccountRecord {
  login: string;
  passwordHash: string;
  deviceId: string;
  createdAt: number;
}

export interface CustomSkinRecord {
  id: string;
  name: string;
  fileName: string;
  mime: 'image/png' | 'image/jpeg' | 'image/webp';
  /** Portable source-of-truth image payload. Loose files are only an optional cache. */
  dataBase64?: string;
  kind?: 'global' | 'shop' | 'level' | 'personal';
  /** Account which owns a moderated personal skin. */
  accountLogin?: string;
  price?: number;
  level?: number;
  createdAt: number;
}

export interface PersistedData {
  version: 6;
  fightTops: Record<FightMode, Record<string, number>>;
  /** Personal best mass records for the current Classic weekly season. */
  classicRecords: Record<string, ClassicRecord>;
  /** Persistent weekly reset deadline for every competitive mode. */
  weeklyTopEndsAt: Record<TopMode, number>;
  /** Agarviki prize for #1 at the end of a weekly mode leaderboard. */
  weeklyTopPrizes: Record<TopMode, number>;
  adminGameplayConfig?: GameplayConfig;
  players: Record<string, PlayerProfile>;
  fingerprints: Record<string, string>;
  /** loginLower → account */
  accounts: Record<string, AccountRecord>;
  /** telegram chatId → login */
  tgAccounts: Record<string, string>;
  customSkins: Record<string, CustomSkinRecord>;
  customSkinOrders: Record<string, { chatId: string; login: string; status: string; dataBase64?: string; mime?: CustomSkinRecord['mime']; paymentMessage?: string; createdAt: number }>;
  telegramChannelUrl?: string;
}

const storePath = join(process.cwd(), 'data', 'agarva.db.json');
const BACKUP_NOTIFY_MS = 5 * 60 * 60 * 1000;
// Profiles and quests can change while the 30 Hz simulation is running. Keep
// those mutations in memory and batch durable writes well away from the hot path.
const SAVE_DEBOUNCE_MS = 5_000;
const DISK_RETRY_COUNT = 5;
const DISK_RETRY_BASE_MS = 40;

const emptyData = (): PersistedData => ({
  version: 6,
  fightTops: { soloFight: {}, duoFight: {}, trioFight: {} },
  classicRecords: {},
  weeklyTopEndsAt: createWeeklyTopEndsAt(),
  weeklyTopPrizes: defaultWeeklyTopPrizes(),
  players: {},
  fingerprints: {},
  accounts: {},
  tgAccounts: {},
  customSkins: {},
  customSkinOrders: {},
});

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
function createWeeklyTopEndsAt(now = Date.now()): Record<TopMode, number> {
  const end = now + WEEK_MS;
  return { classic: end, soloFight: end, duoFight: end, trioFight: end };
}
function defaultWeeklyTopPrizes(): Record<TopMode, number> {
  return { classic: 60, soloFight: 60, duoFight: 60, trioFight: 60 };
}
function normalizeWeeklyTopPrizes(raw: Partial<Record<TopMode, number>> | undefined): Record<TopMode, number> {
  const defaults = defaultWeeklyTopPrizes();
  for (const mode of Object.keys(defaults) as TopMode[]) {
    const value = Number(raw?.[mode]);
    if (Number.isFinite(value)) defaults[mode] = Math.max(0, Math.min(1_000_000, Math.floor(value)));
  }
  return defaults;
}
function normalizeWeeklyEndsAt(raw: Partial<Record<TopMode, number>> | undefined): Record<TopMode, number> {
  const fallback = createWeeklyTopEndsAt();
  for (const mode of Object.keys(fallback) as TopMode[]) {
    const value = Number(raw?.[mode]);
    if (Number.isFinite(value) && value > 0) fallback[mode] = value;
  }
  return fallback;
}

function mergeTopEntries(entries: Record<string, number> | undefined): Record<string, number> {
  const merged: Record<string, number> = {};
  for (const [rawName, rawScore] of Object.entries(entries ?? {})) {
    const name = rawName.trim().toLocaleLowerCase() || rawName.trim();
    const score = Number(rawScore);
    if (!name || !Number.isFinite(score) || score <= 0) continue;
    merged[name] = (merged[name] ?? 0) + score;
  }
  return merged;
}

function mergedFightTops(tops: Partial<Record<FightMode, Record<string, number>>> | undefined) {
  return {
    soloFight: mergeTopEntries(tops?.soloFight),
    duoFight: mergeTopEntries(tops?.duoFight),
    trioFight: mergeTopEntries(tops?.trioFight),
  };
}

export function hashPassword(password: string): string {
  return createHash('sha256').update(`agarva:${password}`).digest('hex');
}

type SaveListener = (json: string, meta: { reason: 'debounce' | 'flush' | 'backup' }) => void;

/** Durable JSON store with debounced disk writes so gameplay never blocks on I/O. */
export class PersistentStore {
  private data: PersistedData;
  private saveListeners: SaveListener[] = [];
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private writeQueue: Promise<void> = Promise.resolve();
  private lastBackupAt = 0;
  /** Latest serialized snapshot kept in memory for TG download without hitting disk. */
  private memoryJson: string;
  private memoryJsonDirty = false;
  private lastDiskErrorAt = 0;

  constructor() {
    this.data = this.load();
    this.memoryJson = JSON.stringify(this.data, null, 2);
    this.lastBackupAt = Date.now();
  }

  get path() {
    return storePath;
  }

  /** In-memory copy for bots / download buttons. */
  getMemoryJson() {
    this.refreshMemoryJson();
    return this.memoryJson;
  }

  onSave(listener: SaveListener) {
    this.saveListeners.push(listener);
  }

  private load(): PersistedData {
    try {
      const parsed = JSON.parse(readFileSync(storePath, 'utf8')) as Partial<PersistedData>;
      return {
        version: 6,
        fightTops: mergedFightTops(parsed.fightTops),
        classicRecords: parsed.classicRecords ?? {},
        weeklyTopEndsAt: normalizeWeeklyEndsAt(parsed.weeklyTopEndsAt),
        weeklyTopPrizes: normalizeWeeklyTopPrizes(parsed.weeklyTopPrizes),
        adminGameplayConfig: parsed.adminGameplayConfig,
        players: parsed.players ?? {},
        fingerprints: parsed.fingerprints ?? {},
        accounts: parsed.accounts ?? {},
        tgAccounts: parsed.tgAccounts ?? {},
        customSkins: parsed.customSkins ?? {},
        customSkinOrders: parsed.customSkinOrders ?? {},
        telegramChannelUrl: typeof parsed.telegramChannelUrl === 'string' ? parsed.telegramChannelUrl : '',
      };
    } catch {
      return emptyData();
    }
  }

  private refreshMemoryJson() {
    if (!this.memoryJsonDirty) return;
    this.memoryJson = JSON.stringify(this.data, null, 2);
    this.memoryJsonDirty = false;
  }

  private static isTransientDiskError(error: unknown) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    return code === 'EPERM' || code === 'EACCES' || code === 'EBUSY';
  }

  private async retryTransient<T>(operation: () => Promise<T>): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt < DISK_RETRY_COUNT; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;
        if (!PersistentStore.isTransientDiskError(error) || attempt === DISK_RETRY_COUNT - 1) break;
        await new Promise<void>((resolve) => {
          setTimeout(resolve, DISK_RETRY_BASE_MS * 2 ** attempt);
        });
      }
    }
    throw lastError;
  }

  private async writeDiskAsync(json: string) {
    await mkdir(dirname(storePath), { recursive: true });
    const tmpPath = `${storePath}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tmpPath, json, 'utf8');
    try {
      // On Windows an AV scanner, Explorer preview, or cloud-sync client can
      // temporarily lock the destination. Retrying the atomic replacement
      // handles the normal short lock without ever blocking the game loop.
      await this.retryTransient(() => rename(tmpPath, storePath));
    } catch (renameError) {
      try {
        // Some Windows locks reject ReplaceFile/rename but allow a regular
        // overwrite. This loses atomic replacement only as a last resort; the
        // fully written temp file remains the source, so a partial JSON is not
        // produced by this process.
        await this.retryTransient(() => copyFile(tmpPath, storePath));
      } catch {
        throw renameError;
      }
    } finally {
      try {
        await unlink(tmpPath);
      } catch {
        // rename consumed it, or a scanner has it briefly open.
      }
    }
  }

  private notifySaved(json: string, reason: 'debounce' | 'flush' | 'backup') {
    for (const listener of this.saveListeners) {
      try {
        listener(json, { reason });
      } catch {
        /* ignore */
      }
    }
  }

  /** Schedule a non-blocking save; coalesces rapid updates. */
  private save() {
    this.memoryJsonDirty = true;
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.refreshMemoryJson();
      const json = this.memoryJson;
      // Preserve write order while keeping disk I/O off the gameplay event loop.
      this.writeQueue = this.writeQueue
        .then(() => this.writeDiskAsync(json))
        .then(() => {
          this.notifySaved(json, 'debounce');
          const now = Date.now();
          if (now - this.lastBackupAt >= BACKUP_NOTIFY_MS) {
            this.lastBackupAt = now;
            this.notifySaved(json, 'backup');
          }
        })
        .catch((error) => this.logDiskError(error));
    }, SAVE_DEBOUNCE_MS);
  }

  private logDiskError(error: unknown) {
    // A persistent external lock should be visible, but not flood the terminal
    // every scheduled save while the in-memory store remains usable.
    const now = Date.now();
    if (now - this.lastDiskErrorAt < 60_000) return;
    this.lastDiskErrorAt = now;
    console.error('[store] disk save failed; continuing in memory:', error);
  }

  /** Queue an immediate durable write without synchronously blocking the game loop. */
  flushNotify() {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    this.memoryJsonDirty = true;
    this.refreshMemoryJson();
    const json = this.memoryJson;
    this.writeQueue = this.writeQueue
      .then(() => this.writeDiskAsync(json))
      .then(() => this.notifySaved(json, 'flush'))
      .catch((error) => this.logDiskError(error));
    return this.memoryJson;
  }

  exportJson(): string {
    this.refreshMemoryJson();
    // Export the authoritative in-memory state, never a potentially stale disk
    // file. This stays complete even while an external Windows lock delays a
    // disk write.
    const parsed = JSON.parse(this.memoryJson) as Partial<PersistedData>;
    if (!parsed.players || !parsed.accounts) {
      throw new Error('Снимок БД повреждён: отсутствуют players или accounts');
    }
    // Start a durable write too, but return this exact in-memory snapshot now:
    // an export must not depend on disk availability or wait on the game loop.
    return this.flushNotify();
  }

  importJson(raw: string): { ok: true } | { ok: false; error: string } {
    try {
      const parsed = JSON.parse(raw) as Partial<PersistedData>;
      if (!parsed || typeof parsed !== 'object') {
        return { ok: false, error: 'Некорректный JSON' };
      }
      if (!parsed.players || typeof parsed.players !== 'object' || !parsed.accounts || typeof parsed.accounts !== 'object') {
        return { ok: false, error: 'Это не полный снимок БД: отсутствуют players или accounts' };
      }
      this.data = {
        version: 6,
        fightTops: mergedFightTops(parsed.fightTops),
        classicRecords: parsed.classicRecords ?? {},
        weeklyTopEndsAt: normalizeWeeklyEndsAt(parsed.weeklyTopEndsAt),
        weeklyTopPrizes: normalizeWeeklyTopPrizes(parsed.weeklyTopPrizes),
        adminGameplayConfig: parsed.adminGameplayConfig,
        players: parsed.players ?? {},
        fingerprints: parsed.fingerprints ?? {},
        accounts: parsed.accounts ?? {},
        tgAccounts: parsed.tgAccounts ?? {},
        customSkins: parsed.customSkins ?? {},
        customSkinOrders: parsed.customSkinOrders ?? {},
        telegramChannelUrl: typeof parsed.telegramChannelUrl === 'string' ? parsed.telegramChannelUrl : '',
      };
      this.flushNotify();
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'Ошибка импорта' };
    }
  }

  /**
   * Applies only the mutable fields owned by the Telegram bot. The bot can
   * hold a cached export for a short time; replacing the whole store from that
   * cache would otherwise erase gameplay progress made in the meantime.
   */
  mergeBotSnapshot(raw: string): { ok: true } | { ok: false; error: string } {
    try {
      const snapshot = JSON.parse(raw) as Partial<PersistedData>;
      if (!snapshot || typeof snapshot !== 'object') return { ok: false, error: 'Некорректный JSON' };

      for (const [chatId, login] of Object.entries(snapshot.tgAccounts ?? {})) {
        if (typeof login === 'string' && login.trim()) this.data.tgAccounts[chatId] = login.trim();
      }
      for (const [id, order] of Object.entries(snapshot.customSkinOrders ?? {})) {
        if (order && typeof order === 'object') this.data.customSkinOrders[id] = order;
      }
      for (const [id, skin] of Object.entries(snapshot.customSkins ?? {})) {
        if (skin?.kind === 'personal' && typeof skin.dataBase64 === 'string') {
          this.data.customSkins[id] = skin;
        }
      }
      // Personal-skin approval changes only an account profile's unlock list.
      // Preserve all current XP, quest state, preferences, and account binding.
      for (const source of Object.values(snapshot.players ?? {})) {
        if (!source?.accountLogin) continue;
        let target = Object.values(this.data.players).find(
          (profile) => profile.accountLogin?.toLowerCase() === source.accountLogin?.toLowerCase()
        );
        // A linked Telegram account can be temporarily absent from `players`
        // (for example after a device migration). Restore the profile on its
        // account-bound device instead of silently losing a paid skin unlock.
        if (!target) {
          const account = this.getAccount(source.accountLogin);
          if (!account?.deviceId) continue;
          target = this.data.players[account.deviceId] ?? {
            lastNick: account.login,
            accountLogin: account.login,
            updatedAt: Date.now(),
          };
          this.data.players[account.deviceId] = target;
        }
        const unlocks = sanitizeQuestProgress(source.quests).unlockedSkinIds;
        if (!unlocks.length) continue;
        const quests = sanitizeQuestProgress(target.quests);
        quests.unlockedSkinIds = [...new Set([...quests.unlockedSkinIds, ...unlocks])];
        target.quests = quests;
        target.updatedAt = Date.now();
      }
      this.save();
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'Ошибка обновления БД' };
    }
  }

  /** Replaces the complete durable game store with the initial empty schema. */
  wipeAll() {
    this.data = emptyData();
    this.flushNotify();
  }

  existsOnDisk() {
    return existsSync(storePath);
  }

  getConfig() {
    return this.data.adminGameplayConfig;
  }

  setConfig(config: GameplayConfig) {
    this.data.adminGameplayConfig = config;
    this.save();
  }

  getCustomSkins(): CustomSkinRecord[] {
    return Object.values(this.data.customSkins).sort((a, b) => b.createdAt - a.createdAt);
  }

  getSkin(idOrFileName: string): CustomSkinRecord | undefined {
    return Object.values(this.data.customSkins).find((skin) => skin.id === idOrFileName || skin.fileName === idOrFileName);
  }

  getTelegramChannelUrl() {
    return this.data.telegramChannelUrl ?? '';
  }

  setTelegramChannelUrl(url: string) {
    this.data.telegramChannelUrl = url.trim().slice(0, 500);
    this.save();
  }

  addCustomSkin(skin: CustomSkinRecord) {
    this.data.customSkins[skin.id] = skin;
    this.save();
  }

  /**
   * Finalize a Telegram-moderated personal skin on the authoritative store.
   * Prefer this over bot-side merge so unlocks never depend on a stale cache.
   */
  completePersonalSkinOrder(orderId: string): { ok: true; skinId: string } | { ok: false; error: string } {
    const order = this.data.customSkinOrders[orderId];
    if (!order) return { ok: false, error: 'Заявка не найдена' };
    if (!order.dataBase64 || !order.mime) return { ok: false, error: 'Изображение скина не найдено' };
    const login = order.login.trim();
    const account = this.data.accounts[login.toLowerCase()];
    if (!account) return { ok: false, error: 'Аккаунт покупателя не найден' };
    let profile =
      (account.deviceId && this.data.players[account.deviceId]) ||
      Object.values(this.data.players).find((p) => p.accountLogin?.toLowerCase() === login.toLowerCase());
    if (!profile) {
      // Recreate a bound profile shell so the unlock is not lost if the device
      // was wiped/unlinked after the order was placed.
      const deviceId = account.deviceId || `tg-${login.toLowerCase()}`;
      account.deviceId = deviceId;
      profile = this.upsertPlayer(deviceId, { accountLogin: account.login, lastNick: account.login });
    }
    const ext = order.mime === 'image/png' ? 'png' : order.mime === 'image/jpeg' ? 'jpg' : 'webp';
    const skinId = `personal-${orderId}`;
    this.data.customSkins[skinId] = {
      id: skinId,
      name: `Кастомный скин ${account.login}`,
      fileName: `${skinId}.${ext}`,
      mime: order.mime,
      dataBase64: order.dataBase64,
      kind: 'personal',
      accountLogin: account.login,
      createdAt: Date.now(),
    };
    const quests = sanitizeQuestProgress(profile.quests ?? createDefaultQuestProgress());
    if (!quests.unlockedSkinIds.includes(skinId)) quests.unlockedSkinIds.push(skinId);
    profile.quests = quests;
    profile.accountLogin = account.login;
    profile.updatedAt = Date.now();
    order.status = 'completed';
    this.save();
    return { ok: true, skinId };
  }

  removeCustomSkin(id: string): CustomSkinRecord | undefined {
    const skin = this.data.customSkins[id];
    if (!skin) return undefined;
    delete this.data.customSkins[id];
    this.save();
    return skin;
  }

  purchaseShopSkin(deviceId: string, skinId: string): { ok: true; profile: PlayerProfile } | { ok: false; error: string } {
    const skin = this.data.customSkins[skinId];
    const profile = this.data.players[deviceId];
    if (!profile?.accountLogin) return { ok: false, error: 'Войдите в аккаунт для покупки' };
    if (!skin || skin.kind !== 'shop') return { ok: false, error: 'Скин недоступен в магазине' };
    const quests = sanitizeQuestProgress(profile.quests ?? createDefaultQuestProgress());
    if (quests.unlockedSkinIds.includes(skin.id)) return { ok: false, error: 'Скин уже куплен' };
    const price = Math.max(0, Math.floor(skin.price ?? 0));
    if (quests.agarviki < price) return { ok: false, error: 'Недостаточно агарвиков' };
    quests.agarviki -= price;
    quests.unlockedSkinIds.push(skin.id);
    profile.quests = quests;
    profile.updatedAt = Date.now();
    this.save();
    return { ok: true, profile };
  }

  addPendingLevelRewards(deviceId: string, levels: number[]) {
    const profile = this.data.players[deviceId];
    if (!profile || levels.length === 0) return;
    profile.pendingLevelRewards = [...new Set([...(profile.pendingLevelRewards ?? []), ...levels])].sort((a, b) => a - b);
    profile.updatedAt = Date.now();
    this.save();
  }

  acknowledgeLevelReward(deviceId: string, level: number) {
    const profile = this.data.players[deviceId];
    if (!profile) return;
    profile.pendingLevelRewards = (profile.pendingLevelRewards ?? []).filter((item) => item !== level);
    profile.updatedAt = Date.now();
    this.save();
  }

  getScores(mode: FightMode) {
    return new Map(
      Object.entries(this.data.fightTops[mode]).filter(([name]) => this.findAccountDeviceByNick(name) !== undefined)
    );
  }

  recordWin(mode: FightMode, deviceId: string | undefined, name: string) {
    const profile = deviceId ? this.data.players[deviceId] : undefined;
    if (!profile?.accountLogin) return undefined;
    const scores = this.data.fightTops[mode];
    const canonicalName = name.trim().toLocaleLowerCase() || 'player';
    scores[canonicalName] = (scores[canonicalName] ?? 0) + 1;
    this.save();
    return scores[canonicalName];
  }

  getClassicRecords(): ClassicRecord[] {
    return Object.values(this.data.classicRecords)
      .filter((record) => Number.isFinite(record.mass) && record.mass > 0)
      .sort((a, b) => b.mass - a.mass || a.updatedAt - b.updatedAt);
  }

  recordClassicMass(deviceId: string, name: string, mass: number, skin?: string) {
    const key = deviceId.trim();
    const nextMass = Math.floor(mass);
    if (!key || !Number.isFinite(nextMass) || nextMass <= 0) return { changed: false, rank: -1, global: false };
    const previous = this.data.classicRecords[key];
    if (previous && nextMass <= previous.mass) return { changed: false, rank: -1, global: false };
    const priorBest = this.getClassicRecords()[0]?.mass ?? 0;
    this.data.classicRecords[key] = {
      deviceId: key,
      name: name.trim().slice(0, 15) || previous?.name || 'Игрок',
      mass: nextMass,
      skin: skin || previous?.skin,
      updatedAt: Date.now(),
    };
    const rank = this.getClassicRecords().findIndex((record) => record.deviceId === key) + 1;
    this.save();
    return { changed: true, rank, global: nextMass > priorBest };
  }

  getWeeklyTopEndsAt(mode: TopMode) {
    return this.data.weeklyTopEndsAt[mode];
  }

  getWeeklyTopPrize(mode: TopMode) {
    return this.data.weeklyTopPrizes[mode];
  }

  setWeeklyTopPrize(mode: TopMode, amount: number) {
    this.data.weeklyTopPrizes[mode] = Math.max(0, Math.min(1_000_000, Math.floor(amount) || 0));
    this.save();
  }

  resetWeeklyTop(mode: TopMode, now = Date.now()) {
    if (mode === 'classic') this.data.classicRecords = {};
    else this.data.fightTops[mode] = {};
    this.data.weeklyTopEndsAt[mode] = now + WEEK_MS;
    this.save();
  }

  /** Credit only an account-bound profile; weekly prizes never create guest balances. */
  awardAgarviki(deviceId: string, amount: number): PlayerProfile | undefined {
    const profile = this.data.players[deviceId];
    if (!profile?.accountLogin) return undefined;
    const quests = sanitizeQuestProgress(profile.quests ?? createDefaultQuestProgress());
    quests.agarviki += Math.max(0, Math.floor(amount));
    profile.quests = quests;
    profile.updatedAt = Date.now();
    this.save();
    return profile;
  }

  /** Best-effort legacy fight-top owner lookup (fight scores predate account attribution). */
  findAccountDeviceByNick(name: string): string | undefined {
    const normalized = name.trim().toLocaleLowerCase();
    return Object.entries(this.data.players).find(([, profile]) =>
      !!profile.accountLogin && profile.lastNick.trim().toLocaleLowerCase() === normalized
    )?.[0];
  }

  /**
   * Prefer fingerprint → known device (cross-browser on same machine),
   * else provided deviceId.
   */
  resolveDeviceId(deviceId: string | undefined, fingerprint: string | undefined): string | null {
    const fp = (fingerprint || '').trim().slice(0, 128);
    if (fp && this.data.fingerprints[fp]) return this.data.fingerprints[fp];
    const id = (deviceId || '').trim().slice(0, 80);
    if (id) return id;
    return null;
  }

  getPlayer(deviceId: string): PlayerProfile | undefined {
    return this.data.players[deviceId];
  }

  upsertPlayer(
    deviceId: string,
    patch: Partial<PlayerProfile> & { fingerprint?: string }
  ): PlayerProfile {
    const id = deviceId.trim().slice(0, 80);
    const prev = this.data.players[id] ?? {
      lastNick: '',
      updatedAt: Date.now(),
    };
    const next: PlayerProfile = {
      ...prev,
      ...patch,
      lastNick: (patch.lastNick ?? prev.lastNick ?? '').trim().slice(0, 15),
      updatedAt: Date.now(),
    };
    // Never overwrite an existing locked account with empty
    if (prev.accountLogin && !patch.accountLogin) {
      next.accountLogin = prev.accountLogin;
    }
    if (prev.quests && !patch.quests) {
      next.quests = prev.quests;
    }
    next.quests = sanitizeQuestProgress(next.quests ?? createDefaultQuestProgress());
    this.data.players[id] = next;
    const fp = (patch.fingerprint || prev.fingerprint || '').trim().slice(0, 128);
    if (fp) {
      next.fingerprint = fp;
      this.data.fingerprints[fp] = id;
    }
    this.save();
    return next;
  }

  registerAccount(
    deviceId: string,
    login: string,
    password: string
  ): { ok: true; profile: PlayerProfile } | { ok: false; error: string } {
    const cleanLogin = login.trim();
    if (!/^[a-zA-Z0-9]+$/.test(cleanLogin)) {
      return { ok: false, error: 'Логин: только латинские буквы и цифры' };
    }
    if (cleanLogin.length < 1 || cleanLogin.length > 15) {
      return { ok: false, error: 'Логин слишком короткий или длинный' };
    }
    if (!password || password.length > 8) {
      return { ok: false, error: 'Пароль: максимум 8 символов' };
    }
    const id = deviceId.trim().slice(0, 80);
    if (!id) return { ok: false, error: 'Нет device id' };
    const existing = this.data.players[id];
    if (existing?.accountLogin) {
      return { ok: false, error: 'На этом устройстве уже есть аккаунт' };
    }
    const key = cleanLogin.toLowerCase();
    if (this.data.accounts[key]) {
      return { ok: false, error: 'Такой логин уже занят' };
    }
    this.data.accounts[key] = {
      login: cleanLogin,
      passwordHash: hashPassword(password),
      deviceId: id,
      createdAt: Date.now(),
    };
    const profile = this.upsertPlayer(id, { accountLogin: cleanLogin, lastNick: existing?.lastNick || cleanLogin });
    return { ok: true, profile };
  }

  loginAccount(
    login: string,
    password: string
  ): { ok: true; account: AccountRecord } | { ok: false; error: string } {
    if (!/^[a-zA-Z0-9]+$/.test(login.trim()) || !password || password.length > 8) {
      return { ok: false, error: 'Неверный логин или пароль' };
    }
    const key = login.trim().toLowerCase();
    const account = this.data.accounts[key];
    if (!account) return { ok: false, error: 'Неверный логин или пароль' };
    if (account.passwordHash !== hashPassword(password)) {
      return { ok: false, error: 'Неверный логин или пароль' };
    }
    return { ok: true, account };
  }

  getAccount(login: string): AccountRecord | undefined {
    return this.data.accounts[login.trim().toLowerCase()];
  }

  isAccountBoundToDevice(login: string | undefined, deviceId: string): boolean {
    if (!login) return false;
    return this.getAccount(login)?.deviceId === deviceId;
  }

  /** Disconnect the account from its current device while retaining progression. */
  unlinkAccountDevice(login: string): { ok: true } | { ok: false; error: string } {
    const account = this.getAccount(login);
    if (!account) return { ok: false, error: 'Аккаунт не найден' };
    const previousDeviceId = account.deviceId;
    account.deviceId = '';
    const previous = this.data.players[previousDeviceId];
    if (previous) {
      delete previous.fingerprint;
      previous.updatedAt = Date.now();
    }
    for (const [fingerprint, deviceId] of Object.entries(this.data.fingerprints)) {
      if (deviceId === previousDeviceId) delete this.data.fingerprints[fingerprint];
    }
    this.save();
    return { ok: true };
  }

  /** Verify an account and restore it on its bound device, or bind a freshly-unlinked account. */
  loginAccountOnDevice(
    deviceId: string,
    login: string,
    password: string
  ): { ok: true; profile: PlayerProfile } | { ok: false; error: string } {
    const result = this.loginAccount(login, password);
    if (!result.ok) return result;
    const id = deviceId.trim().slice(0, 80);
    if (!id) return { ok: false, error: 'Нет device id' };
    if (result.account.deviceId && result.account.deviceId !== id) {
      return { ok: false, error: 'Аккаунт привязан к другому устройству' };
    }
    if (!result.account.deviceId) {
      const oldProfile = Object.values(this.data.players).find(
        (profile) => profile.accountLogin?.toLowerCase() === result.account.login.toLowerCase()
      );
      const currentProfile = this.data.players[id];
      this.data.players[id] = {
        ...(currentProfile ?? {}),
        ...(oldProfile ?? { lastNick: result.account.login, updatedAt: Date.now() }),
        accountLogin: result.account.login,
        updatedAt: Date.now(),
      };
      result.account.deviceId = id;
    }
    const existing = this.data.players[id];
    if (existing?.accountLogin && existing.accountLogin.toLowerCase() !== result.account.login.toLowerCase()) {
      return { ok: false, error: 'На этом устройстве уже есть другой аккаунт' };
    }
    const profile = this.upsertPlayer(id, {
      accountLogin: result.account.login,
      lastNick: existing?.lastNick || result.account.login,
    });
    return { ok: true, profile };
  }

  linkTelegram(chatId: number | string, login: string) {
    this.data.tgAccounts[String(chatId)] = login.trim();
    this.save();
  }

  getTelegramLogin(chatId: number | string): string | undefined {
    return this.data.tgAccounts[String(chatId)];
  }

  /** Finds the Telegram chat linked to this account (case-insensitive login). */
  getTelegramChatId(login: string): string | undefined {
    const key = login.trim().toLowerCase();
    for (const [chatId, linkedLogin] of Object.entries(this.data.tgAccounts)) {
      if (linkedLogin.trim().toLowerCase() === key) return chatId;
    }
    return undefined;
  }

  updateAccountPassword(
    login: string,
    password: string
  ): { ok: true; account: AccountRecord } | { ok: false; error: string } {
    const cleanLogin = login.trim();
    if (!/^[a-zA-Z0-9]{1,15}$/.test(cleanLogin) || !password || password.length > 8) {
      return { ok: false, error: 'Неверные данные для сброса пароля' };
    }
    const account = this.data.accounts[cleanLogin.toLowerCase()];
    if (!account) return { ok: false, error: 'Аккаунт не найден' };
    account.passwordHash = hashPassword(password);
    this.save();
    return { ok: true, account };
  }

  unlinkTelegram(chatId: number | string) {
    delete this.data.tgAccounts[String(chatId)];
    this.save();
  }
}
