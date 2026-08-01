import TelegramBot from 'node-telegram-bot-api';
import { unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { RoomMode } from './soloFight';
import type { FightMode, PersistentStore } from './persistentStore';

type OnlineCounts = Record<RoomMode, { players: number; spectators: number }>;

export interface TelegramGameBridge {
  getOnline(): OnlineCounts;
  sendChat(room: RoomMode, name: string, text: string): void;
  setGameChatRelay(relay: (room: RoomMode, name: string, text: string) => void): void;
  getTop(mode: FightMode): { name: string; score: number }[];
  store?: PersistentStore;
}

const modes: RoomMode[] = ['classic', 'soloFight', 'duoFight', 'trioFight'];
const labels: Record<RoomMode, string> = {
  classic: 'Классик',
  soloFight: 'Соло файт',
  duoFight: 'Дуо файт',
  trioFight: 'Трио файт',
};

type AuthStep = { step: 'login' } | { step: 'password'; login: string };

function isDev(chatId: number): boolean {
  const raw = process.env.TELEGRAM_DEV_ID?.trim();
  if (!raw) return false;
  return String(chatId) === raw;
}

/** Starts only when TELEGRAM_BOT_TOKEN is configured. */
export function startTelegramBot(bridge: TelegramGameBridge) {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (process.env.TELEGRAM_BOT_ENABLED?.trim() === '0') {
    console.log('[telegram] TELEGRAM_BOT_ENABLED=0; bot disabled on this machine');
    return null;
  }
  if (!token) {
    console.log('[telegram] TELEGRAM_BOT_TOKEN is not configured; bot disabled');
    return null;
  }

  // Start polling explicitly after listeners are registered: startup failures
  // (especially Telegram 409 conflicts) must be visible and recoverable.
  const bot = new TelegramBot(token, { polling: false });
  let retryingPollingConflict = false;
  let pollingStoppedForConflict = false;
  const startPolling = (reason: 'startup' | 'retry') => {
    pollingStoppedForConflict = false;
    void bot.startPolling().then(
      () => console.log(`[telegram] polling started (${reason})`),
      (error: Error) => console.error(`[telegram] polling start failed (${reason}):`, error.message)
    );
  };
  const selectedRoom = new Map<number, RoomMode>();
  const authFlow = new Map<number, AuthStep>();
  /** Latest DB JSON kept only in bot process memory (updated from store saves). */
  let memoryDbJson = bridge.store?.getMemoryJson() ?? '';

  const loggedInLogin = (chatId: number) => bridge.store?.getTelegramLogin(chatId);

  const mainKeyboardFor = (chatId: number) => {
    const login = loggedInLogin(chatId);
    const rows: { text: string }[][] = [
      modes.map((mode) => ({ text: labels[mode] })),
      [{ text: 'Онлайн' }, { text: 'Топы' }],
      login ? [{ text: 'Профиль' }] : [{ text: 'Вход в аккаунт' }],
    ];
    if (isDev(chatId)) {
      rows.push([{ text: 'Скачать БД' }, { text: 'Загрузить БД' }]);
    }
    return { keyboard: rows, resize_keyboard: true };
  };
  const connectedKeyboardFor = (chatId: number) => {
    const login = loggedInLogin(chatId);
    const rows: { text: string }[][] = [
      [{ text: 'Выйти из чата' }],
      [{ text: 'Онлайн' }, { text: 'Топы' }],
      login ? [{ text: 'Профиль' }] : [{ text: 'Вход в аккаунт' }],
    ];
    if (isDev(chatId)) {
      rows.push([{ text: 'Скачать БД' }, { text: 'Загрузить БД' }]);
    }
    return { keyboard: rows, resize_keyboard: true };
  };

  const sendMainMenu = (chatId: number, text = 'Выберите комнату, чтобы подключиться к её игровому чату.') =>
    bot.sendMessage(chatId, text, { reply_markup: mainKeyboardFor(chatId) });
  const sendToTelegram = (chatId: number, text: string, options?: Parameters<TelegramBot['sendMessage']>[2]) =>
    void bot.sendMessage(chatId, text, options).catch((error: Error) =>
      console.error('[telegram] send error:', error.message)
    );

  const sendDbFile = async (chatId: number) => {
    if (!isDev(chatId)) {
      sendToTelegram(chatId, 'Команда только для разработчика.');
      return;
    }
    const json = memoryDbJson || bridge.store?.getMemoryJson() || '';
    if (!json) {
      sendToTelegram(chatId, 'В памяти бота пока нет копии БД.');
      return;
    }
    let tmp = '';
    try {
      tmp = join(tmpdir(), `agarva-db-${Date.now()}.json`);
      await writeFile(tmp, json, 'utf8');
      await bot.sendDocument(chatId, tmp, {
        caption: 'Глобальная БД Agarva (из памяти бота)',
      });
    } catch (error) {
      sendToTelegram(chatId, `Не удалось отправить БД: ${error instanceof Error ? error.message : 'error'}`);
    } finally {
      if (tmp) void unlink(tmp).catch(() => {});
    }
  };

  if (bridge.store) {
    const devId = Number(process.env.TELEGRAM_DEV_ID?.trim() || 0);
    bridge.store.onSave((json, meta) => {
      // Always refresh in-memory copy (no Telegram spam).
      memoryDbJson = json;
      // Rare auto-backup to TG (~every 12h), never on every write.
      if (meta.reason === 'backup' && devId) {
        const tmp = join(tmpdir(), `agarva-db-auto-${Date.now()}.json`);
        void writeFile(tmp, json, 'utf8')
          .then(() => bot.sendDocument(devId, tmp, { caption: 'Автобэкап БД Agarva (раз в ~12ч)' }))
          .catch((error: Error) => console.error('[telegram] db backup error:', error.message))
          .finally(() => void unlink(tmp).catch(() => {}));
      }
    });
  }

  bridge.setGameChatRelay((room, name, text) => {
    for (const [chatId, selected] of selectedRoom) {
      if (selected !== room) continue;
      sendToTelegram(chatId, `🎮 ${name}: ${text}`);
    }
  });

  const onlineText = () =>
    modes
      .map((mode) => {
        const c = bridge.getOnline()[mode];
        return `${labels[mode]}: игроков ${c.players}, спеков ${c.spectators}`;
      })
      .join('\n');
  const topsText = () =>
    (['soloFight', 'duoFight', 'trioFight'] as FightMode[])
      .map((mode) => {
        const entries = bridge.getTop(mode).slice(0, 10);
        return `${labels[mode]}\n${entries.length ? entries.map((x, i) => `${i + 1}. ${x.name} — ${x.score}`).join('\n') : 'Пока нет результатов'}`;
      })
      .join('\n\n');

  bot.onText(/^\/(?:start|menu)$/, (msg) => {
    authFlow.delete(msg.chat.id);
    sendMainMenu(msg.chat.id, 'Выберите комнату. После подключения вы будете получать сообщения игрового чата.');
  });
  bot.onText(/^\/online$/, (msg) => sendToTelegram(msg.chat.id, onlineText()));
  bot.onText(/^\/tops$/, (msg) => sendToTelegram(msg.chat.id, topsText()));
  bot.onText(/^\/db$/, (msg) => {
    void sendDbFile(msg.chat.id);
  });

  bot.on('document', (msg) => {
    const chatId = msg.chat.id;
    if (!isDev(chatId)) return;
    if (!bridge.store) {
      sendToTelegram(chatId, 'Хранилище БД недоступно.');
      return;
    }
    const fileId = msg.document?.file_id;
    if (!fileId) return;
    void (async () => {
      try {
        const fileLink = await bot.getFileLink(fileId);
        const res = await fetch(fileLink);
        const text = await res.text();
        const result = bridge.store!.importJson(text);
        if (!result.ok) {
          sendToTelegram(chatId, `Импорт не удался: ${result.error}`);
          return;
        }
        memoryDbJson = bridge.store!.getMemoryJson();
        sendToTelegram(chatId, 'БД загружена и сохранена на диск. Память бота обновлена.');
      } catch (error) {
        sendToTelegram(chatId, `Ошибка загрузки: ${error instanceof Error ? error.message : 'error'}`);
      }
    })();
  });

  bot.on('message', (msg) => {
    if (!msg.text || msg.text.startsWith('/')) return;
    const text = msg.text.trim();
    const chatId = msg.chat.id;

    const flow = authFlow.get(chatId);
    if (flow) {
      if (!bridge.store) {
        authFlow.delete(chatId);
        sendToTelegram(chatId, 'Сервер БД недоступен.');
        return;
      }
      if (flow.step === 'login') {
        if (!/^[a-zA-Z0-9]+$/.test(text)) {
          sendToTelegram(chatId, 'Логин: только латинские буквы и цифры. Попробуйте ещё раз или /menu');
          return;
        }
        authFlow.set(chatId, { step: 'password', login: text });
        sendToTelegram(chatId, 'Введите пароль (макс. 8 символов):');
        return;
      }
      if (flow.step === 'password') {
        const result = bridge.store.loginAccount(flow.login, text);
        authFlow.delete(chatId);
        if (!result.ok) {
          sendToTelegram(chatId, result.error, { reply_markup: mainKeyboardFor(chatId) });
          return;
        }
        bridge.store.linkTelegram(chatId, result.account.login);
        sendToTelegram(chatId, `Вход выполнен: ${result.account.login}`, {
          reply_markup: mainKeyboardFor(chatId),
        });
        return;
      }
    }

    if (text === 'Онлайн') {
      sendToTelegram(chatId, onlineText());
      return;
    }
    if (text === 'Топы') {
      sendToTelegram(chatId, topsText());
      return;
    }
    if (text === 'Вход в аккаунт') {
      if (!bridge.store) {
        sendToTelegram(chatId, 'БД недоступна.');
        return;
      }
      if (loggedInLogin(chatId)) {
        sendToTelegram(chatId, `Вы уже вошли как ${loggedInLogin(chatId)}`, {
          reply_markup: mainKeyboardFor(chatId),
        });
        return;
      }
      authFlow.set(chatId, { step: 'login' });
      sendToTelegram(chatId, 'Введите логин аккаунта (латиница и цифры):');
      return;
    }
    if (text === 'Профиль') {
      const login = loggedInLogin(chatId);
      if (!login) {
        sendToTelegram(chatId, 'Сначала войдите в аккаунт.', { reply_markup: mainKeyboardFor(chatId) });
        return;
      }
      sendToTelegram(chatId, `Профиль: ${login}\n(Раздел пока пуст — скоро здесь появятся данные.)`);
      return;
    }
    if (text === 'Скачать БД') {
      void sendDbFile(chatId);
      return;
    }
    if (text === 'Загрузить БД') {
      if (!isDev(chatId)) {
        sendToTelegram(chatId, 'Команда только для разработчика.');
        return;
      }
      sendToTelegram(chatId, 'Пришлите JSON-файл базы данных (.json) документом в этот чат.');
      return;
    }
    if (text === 'Выйти из чата') {
      selectedRoom.delete(chatId);
      sendMainMenu(chatId, 'Вы вышли из игрового чата и больше не получаете сообщения комнаты.');
      return;
    }
    const mode = modes.find((candidate) => labels[candidate] === text);
    if (mode) {
      selectedRoom.set(chatId, mode);
      sendToTelegram(
        chatId,
        `Подключено к «${labels[mode]}». Ваши сообщения попадут в игру с меткой (TG), а сообщения из игры будут приходить сюда.`,
        { reply_markup: connectedKeyboardFor(chatId) }
      );
      return;
    }

    const room = selectedRoom.get(chatId);
    if (!room) {
      sendMainMenu(chatId, 'Сначала выберите комнату.');
      return;
    }
    const displayName =
      [msg.from?.first_name, msg.from?.last_name].filter(Boolean).join(' ') ||
      (msg.from?.username ? `@${msg.from.username}` : 'Telegram');
    bridge.sendChat(room, displayName.slice(0, 30), text.slice(0, 200));
  });
  bot.on('polling_error', (error) => {
    const message = error.message || String(error);
    if (/409|terminated by other getUpdates|Conflict/i.test(message)) {
      console.error(
        '[telegram] polling conflict (409): another process is using this token. Stop the duplicate bot or set TELEGRAM_BOT_ENABLED=0 locally.'
      );
      if (!pollingStoppedForConflict) {
        pollingStoppedForConflict = true;
        void bot.stopPolling().catch((stopError: Error) =>
          console.error('[telegram] failed to stop conflicted polling:', stopError.message)
        );
      }
      if (!retryingPollingConflict) {
        retryingPollingConflict = true;
        setTimeout(() => {
          console.warn('[telegram] retrying polling once after 409 conflict');
          startPolling('retry');
        }, 5000).unref();
      }
      return;
    }
    console.error('[telegram] polling error:', message);
  });
  bot.on('error', (error) => console.error('[telegram] bot error:', error.message));
  startPolling('startup');
  console.log(`[telegram] bot initialized${process.env.TELEGRAM_DEV_ID ? `; dev id configured` : ''}`);
  return bot;
}
