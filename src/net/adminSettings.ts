import type { GameplayConfig } from '../../shared/gameConfig';

type AdminSettingsAction = 'get' | 'update';

export function requestRemoteAdminSettings(
  url: string,
  name: string,
  action: AdminSettingsAction,
  settings?: GameplayConfig
): Promise<GameplayConfig> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    let done = false;
    let isAdmin = false;

    const finish = (fn: () => void) => {
      if (done) return;
      done = true;
      try {
        fn();
      } finally {
        ws.close();
      }
    };

    ws.onerror = () => finish(() => reject(new Error('Ошибка WebSocket соединения')));
    ws.onclose = () => {
      if (!done) {
        reject(new Error('Соединение закрыто до получения настроек'));
      }
    };
    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'adminIdentify', name }));
    };
    ws.onmessage = (ev) => {
      const msg = JSON.parse(String(ev.data)) as
        | { type: 'adminStatus'; ok: boolean }
        | { type: 'settings'; settings: GameplayConfig }
        | { type: 'error'; message: string };

      if (msg.type === 'error') {
        finish(() => reject(new Error(msg.message)));
        return;
      }
      if (msg.type === 'adminStatus') {
        isAdmin = msg.ok;
        if (!isAdmin) {
          finish(() => reject(new Error('Эта вкладка доступна только для salruz / салруз')));
          return;
        }
        ws.send(JSON.stringify(action === 'get' ? { type: 'adminGetSettings' } : { type: 'adminUpdateSettings', settings }));
        return;
      }
      if (msg.type === 'settings') {
        if (!isAdmin) return;
        finish(() => resolve(msg.settings));
      }
    };
  });
}
