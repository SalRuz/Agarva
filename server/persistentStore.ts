import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from 'node:fs';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import type { GameplayConfig } from '../shared/gameConfig';

export type FightMode = 'soloFight' | 'duoFight' | 'trioFight';

/** Mirror of client player prefs — kept loose so server does not import React client code. */
export type StoredPlayerPrefs = Record<string, unknown>;

export interface PlayerProfile {
  lastNick: string;
  skinId?: string;
  prefs?: StoredPlayerPrefs;
  fingerprint?: string;
  /** Registered account login (latin+digits), locked to this device */
  accountLogin?: string;
  updatedAt: number;
}

export interface AccountRecord {
  login: string;
  passwordHash: string;
  deviceId: string;
  createdAt: number;
}

export interface PersistedData {
  version: 3;
  fightTops: Record<FightMode, Record<string, number>>;
  adminGameplayConfig?: GameplayConfig;
  players: Record<string, PlayerProfile>;
  fingerprints: Record<string, string>;
  /** loginLower → account */
  accounts: Record<string, AccountRecord>;
  /** telegram chatId → login */
  tgAccounts: Record<string, string>;
}

const storePath = join(process.cwd(), 'data', 'agarva.db.json');
const HALF_DAY_MS = 12 * 60 * 60 * 1000;
const SAVE_DEBOUNCE_MS = 750;

const emptyData = (): PersistedData => ({
  version: 3,
  fightTops: { soloFight: {}, duoFight: {}, trioFight: {} },
  players: {},
  fingerprints: {},
  accounts: {},
  tgAccounts: {},
});

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
    return this.memoryJson;
  }

  onSave(listener: SaveListener) {
    this.saveListeners.push(listener);
  }

  private load(): PersistedData {
    try {
      const parsed = JSON.parse(readFileSync(storePath, 'utf8')) as Partial<PersistedData>;
      return {
        version: 3,
        fightTops: {
          soloFight: parsed.fightTops?.soloFight ?? {},
          duoFight: parsed.fightTops?.duoFight ?? {},
          trioFight: parsed.fightTops?.trioFight ?? {},
        },
        adminGameplayConfig: parsed.adminGameplayConfig,
        players: parsed.players ?? {},
        fingerprints: parsed.fingerprints ?? {},
        accounts: parsed.accounts ?? {},
        tgAccounts: parsed.tgAccounts ?? {},
      };
    } catch {
      return emptyData();
    }
  }

  private writeDisk(json: string) {
    mkdirSync(dirname(storePath), { recursive: true });
    const tmpPath = `${storePath}.tmp`;
    writeFileSync(tmpPath, json, 'utf8');
    renameSync(tmpPath, storePath);
  }

  private async writeDiskAsync(json: string) {
    await mkdir(dirname(storePath), { recursive: true });
    const tmpPath = `${storePath}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tmpPath, json, 'utf8');
    await rename(tmpPath, storePath);
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
    this.memoryJson = JSON.stringify(this.data, null, 2);
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      const json = this.memoryJson;
      // Preserve write order while keeping disk I/O off the gameplay event loop.
      this.writeQueue = this.writeQueue
        .then(() => this.writeDiskAsync(json))
        .then(() => {
          this.notifySaved(json, 'debounce');
          const now = Date.now();
          if (now - this.lastBackupAt >= HALF_DAY_MS) {
            this.lastBackupAt = now;
            this.notifySaved(json, 'backup');
          }
        })
        .catch((error) => console.error('[store] disk save failed:', error));
    }, SAVE_DEBOUNCE_MS);
  }

  /** Immediate disk write (admin import/export). */
  flushNotify() {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    this.memoryJson = JSON.stringify(this.data, null, 2);
    this.writeDisk(this.memoryJson);
    // A previously queued asynchronous snapshot may still be in flight. Queue
    // this same authoritative snapshot after it so an older save cannot become
    // the final file after an admin import.
    const json = this.memoryJson;
    this.writeQueue = this.writeQueue
      .then(() => this.writeDiskAsync(json))
      .catch((error) => console.error('[store] disk save failed:', error));
    this.notifySaved(this.memoryJson, 'flush');
    return this.memoryJson;
  }

  exportJson(): string {
    return this.memoryJson;
  }

  importJson(raw: string): { ok: true } | { ok: false; error: string } {
    try {
      const parsed = JSON.parse(raw) as Partial<PersistedData>;
      if (!parsed || typeof parsed !== 'object') {
        return { ok: false, error: 'Некорректный JSON' };
      }
      this.data = {
        version: 3,
        fightTops: {
          soloFight: parsed.fightTops?.soloFight ?? {},
          duoFight: parsed.fightTops?.duoFight ?? {},
          trioFight: parsed.fightTops?.trioFight ?? {},
        },
        adminGameplayConfig: parsed.adminGameplayConfig,
        players: parsed.players ?? {},
        fingerprints: parsed.fingerprints ?? {},
        accounts: parsed.accounts ?? {},
        tgAccounts: parsed.tgAccounts ?? {},
      };
      this.flushNotify();
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'Ошибка импорта' };
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

  getScores(mode: FightMode) {
    return new Map(Object.entries(this.data.fightTops[mode]));
  }

  recordWin(mode: FightMode, name: string) {
    const scores = this.data.fightTops[mode];
    scores[name] = (scores[name] ?? 0) + 1;
    this.save();
    return scores[name];
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

  /** Verify an account and restore it only on the device that created it. */
  loginAccountOnDevice(
    deviceId: string,
    login: string,
    password: string
  ): { ok: true; profile: PlayerProfile } | { ok: false; error: string } {
    const result = this.loginAccount(login, password);
    if (!result.ok) return result;
    const id = deviceId.trim().slice(0, 80);
    if (!id) return { ok: false, error: 'Нет device id' };
    if (result.account.deviceId !== id) {
      return { ok: false, error: 'Аккаунт привязан к другому устройству' };
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
