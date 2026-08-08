import TelegramBot from 'node-telegram-bot-api';
import { createHash } from 'node:crypto';
import { unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import sharp from 'sharp';
import type { BotLogBuffer } from '../server/botLogs';

type Mode = 'classic' | 'soloFight' | 'duoFight' | 'trioFight';
type FightMode = Exclude<Mode, 'classic'>;
type AuthStep = { step: 'login' } | { step: 'password'; login: string };
type SkinOrder = { chatId: string; login: string; status: string; dataBase64?: string; mime?: 'image/png' | 'image/jpeg' | 'image/webp'; paymentMessage?: string; createdAt: number };
type GameDb = {
  accounts?: Record<string, { login: string; passwordHash: string }>;
  tgAccounts?: Record<string, string>;
  players?: Record<string, { accountLogin?: string; quests?: { unlockedSkinIds?: string[] } }>;
  customSkins?: Record<string, { id: string; name: string; fileName: string; mime: 'image/png' | 'image/jpeg' | 'image/webp'; dataBase64: string; kind: 'personal'; accountLogin: string; createdAt: number }>;
  customSkinOrders?: Record<string, SkinOrder>;
};
type BotProfile = {
  login: string;
  deviceId: string | null;
  quest: { level: number; xp: number; agarviki: number; title: string; progress: number; requirement: number };
};
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
  const skinFlow = new Map<number, 'confirm' | 'photo'>();
  /** Developer enters payment details after approving an individual order. */
  const paymentMessageFlow = new Map<number, string>();
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
    // The bot may have cached this snapshot while players earned progress.
    // Merge only bot-owned changes on the server; never replace live profiles
    // with this potentially stale full export.
    await api('/api/bot/db/merge', { method: 'POST', body: JSON.stringify({ json: JSON.stringify(db, null, 2) }) });
    dbCache = db;
  };
  const loggedInLogin = async (chatId: number) => (dbCache ?? await loadDb()).tgAccounts?.[String(chatId)];
  const keyboard = async (chatId: number, connected = false) => {
    const login = await loggedInLogin(chatId);
    const rows: { text: string }[][] = [
      modes.map((mode) => ({ text: labels[mode] })), [{ text: 'Онлайн' }, { text: 'Топы' }],
      login ? [{ text: 'Профиль' }, { text: 'Отвязать от устройства' }, { text: 'Купить кастомный скин' }] : [{ text: 'Вход в аккаунт' }],
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
  const profileText = async (login: string) => {
    const profile = await api<BotProfile>(`/api/bot/profile?login=${encodeURIComponent(login)}`);
    const device = profile.deviceId
      ? `${profile.deviceId.slice(0, 6)}…${profile.deviceId.slice(-4)}`
      : 'не привязан';
    return [
      `Профиль: ${profile.login}`,
      `Уровень: ${profile.quest.level} · XP: ${profile.quest.xp}`,
      `Агарвики: ${profile.quest.agarviki}`,
      `Текущее задание: ${profile.quest.title} (${Math.floor(profile.quest.progress)} / ${Math.floor(profile.quest.requirement)})`,
      `Устройство: ${device}`,
    ].join('\n');
  };
  const sendPersonalSkins = async (chatId: number, login: string) => {
    const db = dbCache ?? await loadDb();
    const skins = Object.values(db.customSkins ?? {}).filter((skin) => skin.kind === 'personal' && skin.accountLogin.toLowerCase() === login.toLowerCase());
    if (!skins.length) return bot.sendMessage(chatId, 'Личных кастомных скинов пока нет.');
    await bot.sendMessage(chatId, 'Ваши личные скины:');
    for (const skin of skins) {
      const preview = await sharp(Buffer.from(skin.dataBase64, 'base64'))
        .resize(512, 512, { fit: 'cover' })
        .composite([{ input: Buffer.from('<svg width="512" height="512"><circle cx="256" cy="256" r="256" fill="white"/></svg>'), blend: 'dest-in' }])
        .png()
        .toBuffer();
      await bot.sendPhoto(chatId, preview, { caption: `◯ ${skin.name}` });
    }
  };
  const sendDbFile = async (chatId: number) => {
    if (!isDev(chatId)) return;
    const { json } = await api<{ json: string }>('/api/bot/db');
    const file = join(tmpdir(), `agarva-db-${Date.now()}.json`);
    try { await writeFile(file, json, 'utf8'); await bot.sendDocument(chatId, file, { caption: 'Глобальная БД Agarva' }); }
    finally { await unlink(file).catch(() => {}); }
  };
  const sendScheduledDbBackup = async () => {
    const chatId = Number(process.env.TELEGRAM_DEV_ID?.trim());
    if (!Number.isSafeInteger(chatId)) return;
    await sendDbFile(chatId);
    logs.write('info', 'Пятичасовой бэкап БД отправлен разработчику.');
  };
  const passwordHash = (password: string) => createHash('sha256').update(`agarva:${password}`).digest('hex');
  const imageMime = (data: Buffer): SkinOrder['mime'] | null => {
    if (data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
    if (data[0] === 0xff && data[1] === 0xd8) return 'image/jpeg';
    if (data.subarray(0, 4).toString() === 'RIFF' && data.subarray(8, 12).toString() === 'WEBP') return 'image/webp';
    return null;
  };
  const orderFor = (db: GameDb, chatId: number, status: string) =>
    Object.entries(db.customSkinOrders ?? {}).find(([, order]) => order.chatId === String(chatId) && order.status === status);
  const finishPersonalSkin = async (_db: GameDb, orderId: string, _order: SkinOrder) => {
    await api('/api/bot/complete-skin-order', { method: 'POST', body: JSON.stringify({ orderId }) });
    dbCache = await loadDb();
  };
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
    const pending = dbCache && orderFor(dbCache, msg.chat.id, 'approved');
    if (pending && msg.document?.file_id) {
      void (async () => {
        const [orderId, order] = pending;
        order.status = 'payment_sent'; await saveDb(dbCache!);
        const devId = Number(process.env.TELEGRAM_DEV_ID);
        await bot.forwardMessage(devId, msg.chat.id, msg.message_id);
        await bot.sendMessage(devId, `Оплата кастомного скина ${order.login}`, { reply_markup: { inline_keyboard: [[{ text: 'Подтвердить оплату', callback_data: `skin:paid:${orderId}` }, { text: 'Отклонить', callback_data: `skin:reject:${orderId}` }]] } });
        await bot.sendMessage(msg.chat.id, 'Чек отправлен на проверку.');
      })().catch((error) => sendError(msg.chat.id, error));
      return;
    }
    if (!isDev(msg.chat.id) || !msg.document?.file_id) return;
    void (async () => {
      const json = await (await fetch(await bot.getFileLink(msg.document!.file_id))).text();
      JSON.parse(json); await api('/api/bot/db', { method: 'POST', body: JSON.stringify({ json }) }); dbCache = JSON.parse(json) as GameDb;
      await bot.sendMessage(msg.chat.id, 'БД загружена на игровой хост.');
    })().catch((error) => sendError(msg.chat.id, error));
  });
  bot.on('photo', (msg) => {
    const awaitingProof = dbCache && orderFor(dbCache, msg.chat.id, 'approved');
    if (awaitingProof) {
      void bot.sendMessage(msg.chat.id, 'Чек нужно прислать как файл/документ, не как сжатое фото. Нажмите скрепку → «Файл» и отправьте изображение документом.');
      return;
    }
    if (skinFlow.get(msg.chat.id) !== 'photo') return;
    void (async () => {
      const login = await loggedInLogin(msg.chat.id);
      if (!login) throw new Error('Сначала войдите в аккаунт.');
      const photo = msg.photo?.at(-1);
      if (!photo) throw new Error('Фото не найдено');
      const data = Buffer.from(await (await fetch(await bot.getFileLink(photo.file_id))).arrayBuffer());
      const mime = imageMime(data);
      if (!mime) throw new Error('Поддерживаются PNG, JPG и WEBP');
      const db = await loadDb();
      const moderationCount = Object.values(db.customSkinOrders ?? {}).filter((order) => ['moderation', 'pending', 'awaiting_review'].includes(order.status)).length;
      if (moderationCount >= 10) {
        skinFlow.delete(msg.chat.id);
        return void bot.sendMessage(msg.chat.id, 'Очередь модерации переполнена (10 заявок). Попробуйте позже.');
      }
      const id = `order-${Date.now()}-${msg.chat.id}`;
      db.customSkinOrders ??= {};
      db.customSkinOrders[id] = { chatId: String(msg.chat.id), login, status: 'moderation', dataBase64: data.toString('base64'), mime, createdAt: Date.now() };
      await saveDb(db); skinFlow.delete(msg.chat.id);
      const devId = Number(process.env.TELEGRAM_DEV_ID);
      await bot.forwardMessage(devId, msg.chat.id, msg.message_id);
      await bot.sendMessage(devId, `Скин на модерацию: ${login}`, { reply_markup: { inline_keyboard: [[{ text: 'Одобрить', callback_data: `skin:approve:${id}` }, { text: 'Отклонить', callback_data: `skin:reject:${id}` }]] } });
      await bot.sendMessage(msg.chat.id, 'Скин отправлен разработчику на модерацию.');
    })().catch((error) => sendError(msg.chat.id, error));
  });
  bot.on('callback_query', (query) => {
    if (query.data === 'profile:skins') {
      void (async () => {
        const login = await loggedInLogin(query.message!.chat.id);
        if (!login) throw new Error('Сначала войдите в аккаунт.');
        await sendPersonalSkins(query.message!.chat.id, login);
        await bot.answerCallbackQuery(query.id);
      })().catch((error) => sendError(query.message?.chat.id ?? 0, error));
      return;
    }
    if (!isDev(query.message?.chat.id ?? 0) || !query.data?.startsWith('skin:')) return;
    void (async () => {
      const [, action, orderId] = query.data!.split(':');
      const db = await loadDb(), order = db.customSkinOrders?.[orderId];
      if (!order) throw new Error('Заявка не найдена');
      if (action === 'approve') {
        order.status = 'awaiting_payment_message'; await saveDb(db);
        paymentMessageFlow.set(query.message!.chat.id, orderId);
        await bot.sendMessage(query.message!.chat.id, `Скин ${order.login} одобрен. Напишите одним сообщением реквизиты / инструкции для покупателя.`);
      } else if (action === 'paid') {
        await finishPersonalSkin(db, orderId, order);
        await bot.sendMessage(Number(order.chatId), 'Оплата подтверждена. Скин готов и добавлен в личные скины игры.');
      } else {
        order.status = 'rejected'; await saveDb(db);
        await bot.sendMessage(Number(order.chatId), action === 'reject' ? 'Заявка на кастомный скин отклонена.' : 'Оплата не подтверждена.');
      }
      await bot.answerCallbackQuery(query.id);
    })().catch((error) => sendError(query.message?.chat.id ?? 0, error));
  });
  bot.on('message', (msg) => {
    if (!msg.text || msg.text.startsWith('/')) return;
    void (async () => {
      const chatId = msg.chat.id, text = msg.text!.trim(), flow = authFlow.get(chatId);
      const paymentOrderId = paymentMessageFlow.get(chatId);
      if (paymentOrderId && isDev(chatId)) {
        const db = await loadDb(), order = db.customSkinOrders?.[paymentOrderId];
        if (!order || order.status !== 'awaiting_payment_message') throw new Error('Заявка ожидает другой этап или уже закрыта');
        order.paymentMessage = text.slice(0, 3500);
        order.status = 'approved';
        await saveDb(db);
        paymentMessageFlow.delete(chatId);
        await bot.sendMessage(Number(order.chatId), `Скин одобрен. Стоимость — 200 рублей.\n\n${order.paymentMessage}\n\nПосле оплаты пришлите чек только как файл/документ (не сжатое фото).`);
        return void bot.sendMessage(chatId, 'Сообщение с реквизитами отправлено покупателю.');
      }
      if (skinFlow.get(chatId) === 'confirm') {
        if (/^(да|yes)$/iu.test(text)) { skinFlow.set(chatId, 'photo'); return void bot.sendMessage(chatId, 'Отправьте фото будущего скина (PNG, JPG или WEBP).'); }
        skinFlow.delete(chatId); return void bot.sendMessage(chatId, 'Покупка кастомного скина отменена.');
      }
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
      if (text === 'Профиль') {
        const login = await loggedInLogin(chatId);
        if (!login) return void bot.sendMessage(chatId, 'Сначала войдите в аккаунт.');
        await bot.sendMessage(chatId, await profileText(login), { reply_markup: { inline_keyboard: [[{ text: 'Мои личные скины', callback_data: 'profile:skins' }]] } });
        return;
      }
      if (text === 'Купить кастомный скин') {
        if (!await loggedInLogin(chatId)) return void bot.sendMessage(chatId, 'Сначала войдите в аккаунт игры.');
        const db = await loadDb();
        const moderationCount = Object.values(db.customSkinOrders ?? {}).filter((order) => ['moderation', 'pending', 'awaiting_review'].includes(order.status)).length;
        if (moderationCount >= 10) return void bot.sendMessage(chatId, 'Очередь модерации переполнена (10 заявок). Попробуйте позже.');
        skinFlow.set(chatId, 'confirm');
        return void bot.sendMessage(chatId, 'Кастомный скин стоит 200 рублей. Продолжить? Ответьте «да» или «нет».');
      }
      if (text === 'Отвязать от устройства') {
        const login = await loggedInLogin(chatId);
        if (!login) return void bot.sendMessage(chatId, 'Сначала войдите в аккаунт.');
        await api('/api/bot/unlink-device', { method: 'POST', body: JSON.stringify({ login }) });
        return void bot.sendMessage(chatId, 'Устройство отвязано. На старом устройстве потребуется вход; на новом войдите логином и паролем.');
      }
      if (text === 'Скачать БД') return void sendDbFile(chatId);
      if (text === 'Загрузить БД') return void bot.sendMessage(chatId, 'Пришлите JSON-файл БД документом.');
      if (text === 'Выйти из чата') { selectedRoom.delete(chatId); return void sendMenu(chatId, 'Вы вышли из игрового чата.'); }
      const room = modes.find((mode) => labels[mode] === text);
      if (room) {
        // A newly selected room must never replay the full retained buffer.
        // Fetch just the latest five before subscribing this chat to polling.
        const history = await api<{ lines: ChatLine[]; lastId: number }>(`/api/bot/chat-out?room=${room}&since=0&limit=5`);
        chatCursor.set(room, history.lastId);
        selectedRoom.set(chatId, room);
        await bot.sendMessage(chatId, `Подключено к «${labels[room]}».`, { reply_markup: await keyboard(chatId, true) });
        for (const line of history.lines) {
          await bot.sendMessage(chatId, `🎮 ${line.name}: ${line.text}`);
        }
        return;
      }
      const selected = selectedRoom.get(chatId);
      if (!selected) return void sendMenu(chatId, 'Сначала выберите комнату.');
      const name = [msg.from?.first_name, msg.from?.last_name].filter(Boolean).join(' ') || msg.from?.username || 'Telegram';
      await api('/api/bot/chat', { method: 'POST', body: JSON.stringify({ room: selected, name: name.slice(0, 30), text: text.slice(0, 200) }) });
    })().catch((error) => sendError(msg.chat.id, error));
  });
  setInterval(() => void pollGameChat().catch((error) => logs.write('warn', `Чат: ${String(error)}`)), 2_000).unref();
  setInterval(() => void pollOutbox().catch((error) => logs.write('warn', `Outbox: ${String(error)}`)), 1_500).unref();
  setInterval(() => void loadDb().catch((error) => logs.write('warn', `Обновление БД: ${String(error)}`)), 60_000).unref();
  setInterval(() => void sendScheduledDbBackup().catch((error) => logs.write('warn', `Бэкап БД: ${String(error)}`)), 5 * 60 * 60 * 1000).unref();
  void loadDb().catch((error) => logs.write('warn', `Начальная БД: ${String(error)}`));
  void pollOutbox().catch((error) => logs.write('warn', `Начальный outbox: ${String(error)}`));
  logs.write('info', `Бот запущен; игровой API: ${gameApiUrl}`);
}
