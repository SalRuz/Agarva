import type { GameplayConfig } from '../../shared/gameConfig';

type AdminSettingsAction = 'get' | 'update';
export type AdminSettingsMode = 'classic' | 'soloFight';

export function requestRemoteAdminSettings(
  url: string,
  name: string,
  action: AdminSettingsAction,
  settings?: GameplayConfig,
  password?: string,
  mode: AdminSettingsMode = 'classic'
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
      const identify: { type: 'adminIdentify'; name: string; password?: string } = {
        type: 'adminIdentify',
        name,
      };
      if (password) identify.password = password;
      ws.send(JSON.stringify(identify));
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
          finish(() => reject(new Error('Неверный пароль или ник не salruz')));
          return;
        }
        ws.send(
          JSON.stringify(
            action === 'get'
              ? { type: 'adminGetSettings', mode }
              : { type: 'adminUpdateSettings', settings, mode }
          )
        );
        return;
      }
      if (msg.type === 'settings') {
        if (!isAdmin) return;
        finish(() => resolve(msg.settings));
      }
    };
  });
}

/** Download global persistent DB as JSON string (admin only). */
export function requestRemoteAdminDbDownload(
  url: string,
  name: string,
  password?: string
): Promise<string> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    let done = false;

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
      if (!done) reject(new Error('Соединение закрыто до скачивания БД'));
    };
    ws.onopen = () => {
      const identify: { type: 'adminIdentify'; name: string; password?: string } = {
        type: 'adminIdentify',
        name,
      };
      if (password) identify.password = password;
      ws.send(JSON.stringify(identify));
    };
    ws.onmessage = (ev) => {
      const msg = JSON.parse(String(ev.data)) as
        | { type: 'adminStatus'; ok: boolean }
        | { type: 'adminDbExport'; json: string }
        | { type: 'error'; message: string };
      if (msg.type === 'error') {
        finish(() => reject(new Error(msg.message)));
        return;
      }
      if (msg.type === 'adminStatus') {
        if (!msg.ok) {
          finish(() => reject(new Error('Неверный пароль или ник не salruz')));
          return;
        }
        ws.send(JSON.stringify({ type: 'adminDownloadDb' }));
        return;
      }
      if (msg.type === 'adminDbExport') {
        finish(() => resolve(msg.json));
      }
    };
  });
}

/** Upload/replace global persistent DB (admin only). */
export function requestRemoteAdminDbUpload(
  url: string,
  name: string,
  json: string,
  password?: string
): Promise<string> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    let done = false;

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
      if (!done) reject(new Error('Соединение закрыто до загрузки БД'));
    };
    ws.onopen = () => {
      const identify: { type: 'adminIdentify'; name: string; password?: string } = {
        type: 'adminIdentify',
        name,
      };
      if (password) identify.password = password;
      ws.send(JSON.stringify(identify));
    };
    ws.onmessage = (ev) => {
      const msg = JSON.parse(String(ev.data)) as
        | { type: 'adminStatus'; ok: boolean }
        | { type: 'adminDbResult'; ok: boolean; message: string }
        | { type: 'error'; message: string };
      if (msg.type === 'error') {
        finish(() => reject(new Error(msg.message)));
        return;
      }
      if (msg.type === 'adminStatus') {
        if (!msg.ok) {
          finish(() => reject(new Error('Неверный пароль или ник не salruz')));
          return;
        }
        ws.send(JSON.stringify({ type: 'adminUploadDb', json }));
        return;
      }
      if (msg.type === 'adminDbResult') {
        if (!msg.ok) finish(() => reject(new Error(msg.message)));
        else finish(() => resolve(msg.message));
      }
    };
  });
}
