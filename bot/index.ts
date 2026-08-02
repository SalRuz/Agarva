import TelegramBot from 'node-telegram-bot-api';
import { createHash } from 'node:crypto';
import { unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { BotLogBuffer } from '../server/botLogs';

type Mode = 'classic' | 'soloFight' | 'duoFight' | 'trioFight';
type FightMode = Exclude<Mode, 'classic'>;
type AuthStep = { step: 'login' } | { step: 'password'; login: string };
type GameDb = { accounts?: Record<string, { login: string; passwordHash: string }>; tgAccounts?: Record<string, string> };
type ChatLine = { id: number; room: Mode; name: string; text: string; t: number };
type OutboxMessage = { id: number; chatId: string; text: string };

const modes: Mode[] = ['classic', 'soloFight', 'duoFight', 'trioFight'];
const labels: Record<Mode, string> = {
  classic: 'Классик', soloFight: 'Соло файт', duoFight: 'Дуо файт', trioFight: 'Трио файт',
};

/** Starts polling without blocking the game server. Missing/invalid Telegram config never throws. */
export function startTelegramBot(logs: BotLogBuffer, gameApiUrl: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const apiSecret = process.env.GAME_API_SECRET?.trim();
  if (process.env.TELEGRAM_BOT_ENABLED !== '1') {
    logs.write('info', 'Запуск отключён: TELEGRAM_BOT_ENABLED не равен 1.');
    return;
  }
  if (!token || !apiSecret) {
    logs.write('warn', 'Бот не запущен: задайте TELEGRAM_BOT_TOKEN и GAME_API_SECRET.');
    return;
  }

  const bot = new TelegramBot(token, { polling: true });
  const selectedRoom = new Map<number, Mode>();
  const authFlow = new Map<number, AuthStep>();
  const chatCursor = new Map<Mode, number>();
  let dbCache: GameDb | null = null;
  const isDev = (chatId: number) => String(chatId) === process.env.TELEGRAM_DEV_ID?.trim();

  const api = async <T>(path: string, init?: RequestInit): Promise<T> => {
    const response = await fetch(`${gameApiUrl}${path}`, {
      ...init,
      headers: { 'x-game-api-secret': apiSecret, ...(init?.body ? { 'content-type': 'application/json' } : {}), ...init?.headers },
    });
    if (!response.ok) throw new Error(`Game API ${response.status}: ${await response.text()}`);
    return response.json() as Promise<T>;
  };
  const loadDb = async () => {
    const result = await api<{ json: string }>('/api/bot/db');
    dbCache = JSON.parse(result.json) as GameDb;
    return dbCache;
  };
  const saveDb = async (db: GameDb) => {
    await api('/api/bot/db', { method: 'POST', body: JSON.stringify({ json: JSON.stringify(db, null, 2) }) });
    dbCache = db;
  };
  const loggedInLogin = async (chatId: number) => (dbCache ?? await loadDb()).tgAccounts?.[String(chatId)];
  const keyboard = async (chatId: number, connected = false) => {
    const login = await loggedInLogin(chatId);
    const rows: { text: string }[][] = [
      modes.map((mode) => ({ text: labels[mode] })), [{ text: 'Онлайн' }, { text: 'Топы' }],
      login ? [{ text: 'Профиль' }] : [{ text: 'Вход в аккаунт' }],
    ];
    if (isDev(chatId)) rows.push([{ text: 'Скачать БД' }, { text: 'Загрузить БД' }]);
    if (connected) rows.unshift([{ text: 'Выйти из чата' }]);
    return { keyboard: rows, resize_keyboard: true };
  };
  const sendError = (chatId: number, error: unknown) => {
    const text = error instanceof Error ? error.message : 'неизвестная ошибка';
    logs.write('error', text);
    void bot.sendMessage(chatId, `Ошибка: ${text}`).catch(() => {});
  };
  const sendMenu = async (chatId: number, text = 'Выберите комнату, чтобы подключиться к игровому чату.') =>
    bot.sendMessage(chatId, text, { reply_markup: await keyboard(chatId) });
  const onlineText = async () => {
    const counts = await api<Record<Mode, { players: number; spectators: number }>>('/api/bot/online');
    return modes.map((mode) => `${labels[mode]}: игроков ${counts[mode].players}, спеков ${counts[mode].spectators}`).join('\n');
  };
  const topsText = async () => (await Promise.all((['soloFight', 'duoFight', 'trioFight'] as FightMode[]).map(async (mode) => {
    const entries = await api<{ name: string; score: number }[]>(`/api/bot/tops?mode=${mode}`);
    return `${labels[mode]}\n${entries.slice(0, 10).map((x, i) => `${i + 1}. ${x.name} — ${x.score}`).join('\n') || 'Пока нет результатов'}`;
  }))).join('\n\n');
  const sendDbFile = async (chatId: number) => {
    if (!isDev(chatId)) return;
    const { json } = await api<{ json: string }>('/api/bot/db');
    const file = join(tmpdir(), `agarva-db-${Date.now()}.json`);
    try { await writeFile(file, json, 'utf8'); await bot.sendDocument(chatId, file, { caption: 'Глобальная БД Agarva' }); }
    finally { await unlink(file).catch(() => {}); }
  };
  const passwordHash = (password: string) => createHash('sha256').update(`agarva:${password}`).digest('hex');
  const pollGameChat = async () => {
    for (const room of new Set(selectedRoom.values())) {
      const response = await api<{ lines: ChatLine[]; lastId: number }>(`/api/bot/chat-out?room=${room}&since=${chatCursor.get(room) ?? 0}`);
      chatCursor.set(room, response.lastId);
      for (const line of response.lines) for (const [chatId, selected] of selectedRoom) {
        if (selected === room) await bot.sendMessage(chatId, `🎮 ${line.name}: ${line.text}`).catch(() => {});
      }
    }
  };
  const pollOutbox = async () => {
    const { messages } = await api<{ messages: OutboxMessage[] }>('/api/bot/outbox');
    for (const message of messages) await bot.sendMessage(message.chatId, message.text).catch((error) => logs.write('warn', `Не доставлено сообщение ${message.chatId}: ${String(error)}`));
  };

  bot.on('polling_error', (error) => logs.write('error', `Polling: ${error.message}`));
  bot.onText(/^\/(?:start|menu)$/, (msg) => { authFlow.delete(msg.chat.id); void sendMenu(msg.chat.id).catch((error) => sendError(msg.chat.id, error)); });
  bot.onText(/^\/online$/, (msg) => void onlineText().then((text) => bot.sendMessage(msg.chat.id, text)).catch((error) => sendError(msg.chat.id, error)));
  bot.onText(/^\/tops$/, (msg) => void topsText().then((text) => bot.sendMessage(msg.chat.id, text)).catch((error) => sendError(msg.chat.id, error)));
  bot.onText(/^\/db$/, (msg) => void sendDbFile(msg.chat.id).catch((error) => sendError(msg.chat.id, error)));
  bot.on('document', (msg) => {
    if (!isDev(msg.chat.id) || !msg.document?.file_id) return;
    void (async () => {
      const json = await (await fetch(await bot.getFileLink(msg.document!.file_id))).text();
      JSON.parse(json); await api('/api/bot/db', { method: 'POST', body: JSON.stringify({ json }) }); dbCache = JSON.parse(json) as GameDb;
      await bot.sendMessage(msg.chat.id, 'БД загружена на игровой хост.');
    })().catch((error) => sendError(msg.chat.id, error));
  });
  bot.on('message', (msg) => {
    if (!msg.text || msg.text.startsWith('/')) return;
    void (async () => {
      const chatId = msg.chat.id, text = msg.text!.trim(), flow = authFlow.get(chatId);
      if (flow?.step === 'login') {
        if (!/^[a-zA-Z0-9]{1,15}$/.test(text)) return void bot.sendMessage(chatId, 'Логин: латинские буквы и цифры (до 15).');
        authFlow.set(chatId, { step: 'password', login: text }); return void bot.sendMessage(chatId, 'Введите пароль (макс. 8 символов):');
      }
      if (flow?.step === 'password') {
        const db = await loadDb(), account = db.accounts?.[flow.login.toLowerCase()]; authFlow.delete(chatId);
        if (!account || account.passwordHash !== passwordHash(text)) return void bot.sendMessage(chatId, 'Неверный логин или пароль.');
        db.tgAccounts ??= {}; db.tgAccounts[String(chatId)] = account.login; await saveDb(db);
        return void bot.sendMessage(chatId, `Вход выполнен: ${account.login}`, { reply_markup: await keyboard(chatId) });
      }
      if (text === 'Онлайн') return void bot.sendMessage(chatId, await onlineText());
      if (text === 'Топы') return void bot.sendMessage(chatId, await topsText());
      if (text === 'Вход в аккаунт') { if (await loggedInLogin(chatId)) return void bot.sendMessage(chatId, 'Вы уже вошли в аккаунт.'); authFlow.set(chatId, { step: 'login' }); return void bot.sendMessage(chatId, 'Введите логин аккаунта:'); }
      if (text === 'Профиль') { const login = await loggedInLogin(chatId); return void bot.sendMessage(chatId, login ? `Профиль: ${login}` : 'Сначала войдите в аккаунт.'); }
      if (text === 'Скачать БД') return void sendDbFile(chatId);
      if (text === 'Загрузить БД') return void bot.sendMessage(chatId, 'Пришлите JSON-файл БД документом.');
      if (text === 'Выйти из чата') { selectedRoom.delete(chatId); return void sendMenu(chatId, 'Вы вышли из игрового чата.'); }
      const room = modes.find((mode) => labels[mode] === text);
      if (room) { selectedRoom.set(chatId, room); return void bot.sendMessage(chatId, `Подключено к «${labels[room]}».`, { reply_markup: await keyboard(chatId, true) }); }
      const selected = selectedRoom.get(chatId);
      if (!selected) return void sendMenu(chatId, 'Сначала выберите комнату.');
      const name = [msg.from?.first_name, msg.from?.last_name].filter(Boolean).join(' ') || msg.from?.username || 'Telegram';
      await api('/api/bot/chat', { method: 'POST', body: JSON.stringify({ room: selected, name: name.slice(0, 30), text: text.slice(0, 200) }) });
    })().catch((error) => sendError(msg.chat.id, error));
  });
  setInterval(() => void pollGameChat().catch((error) => logs.write('warn', `Чат: ${String(error)}`)), 2_000).unref();
  setInterval(() => void pollOutbox().catch((error) => logs.write('warn', `Outbox: ${String(error)}`)), 1_500).unref();
  setInterval(() => void loadDb().catch((error) => logs.write('warn', `Обновление БД: ${String(error)}`)), 60_000).unref();
  void loadDb().catch((error) => logs.write('warn', `Начальная БД: ${String(error)}`));
  void pollOutbox().catch((error) => logs.write('warn', `Начальный outbox: ${String(error)}`));
  logs.write('info', `Бот запущен; игровой API: ${gameApiUrl}`);
}
