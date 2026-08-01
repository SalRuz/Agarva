/**
 * Standalone Telegram bot — can download/upload the game DB even when the
 * game WebSocket server is offline (shares `data/agarva.db.json` on disk).
 *
 * Usage: npm run bot
 */
import 'dotenv/config';
import { PersistentStore } from './persistentStore';
import { startTelegramBot } from './telegramBot';

const store = new PersistentStore();

startTelegramBot({
  store,
  getOnline: () => ({
    classic: { players: 0, spectators: 0 },
    soloFight: { players: 0, spectators: 0 },
    duoFight: { players: 0, spectators: 0 },
    trioFight: { players: 0, spectators: 0 },
  }),
  sendChat: () => {
    console.log('[bot-only] game server offline — chat relay ignored');
  },
  setGameChatRelay: () => {},
  getTop: (mode) =>
    [...store.getScores(mode).entries()]
      .map(([name, score]) => ({ name, score }))
      .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name)),
});

console.log('[bot-only] Telegram bot running against', store.path);
console.log('[bot-only] Dev can Скачать/Загрузить БД without the game server.');
