import { mkdir, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const MAX_LINES = 400;
const LOG_FILE = join(process.cwd(), 'data', 'bot-logs.txt');

/** Small persistent ring buffer for the embedded Telegram bot diagnostics. */
export class BotLogBuffer {
  private lines: string[];

  constructor() {
    try {
      this.lines = readFileSync(LOG_FILE, 'utf8').split(/\r?\n/).filter(Boolean).slice(-MAX_LINES);
    } catch {
      this.lines = [];
    }
  }

  write(level: 'info' | 'warn' | 'error', message: string) {
    const line = `${new Date().toISOString()} [${level}] ${message}`;
    this.lines.push(line);
    if (this.lines.length > MAX_LINES) this.lines.splice(0, this.lines.length - MAX_LINES);
    console[level === 'info' ? 'log' : level](`[telegram] ${message}`);
    void this.persist();
  }

  getText() {
    return this.lines.join('\n') || 'Логов Telegram-бота пока нет.';
  }

  private async persist() {
    try {
      await mkdir(dirname(LOG_FILE), { recursive: true });
      await writeFile(LOG_FILE, `${this.lines.join('\n')}\n`, 'utf8');
    } catch (error) {
      console.error('[telegram] cannot persist bot log:', error);
    }
  }
}
