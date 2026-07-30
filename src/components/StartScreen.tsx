import { useState, useEffect } from 'react';
import { resolveServerUrl } from '../net/MultiplayerClient';
import { isAdminName } from '../../shared/physics';
import { ADMIN_PASSWORD } from '../../shared/constants';

interface StartScreenProps {
  name: string;
  onNameChange: (name: string) => void;
  password: string;
  onPasswordChange: (password: string) => void;
  onStart: (name: string, serverUrl: string, password?: string) => void;
  onSpectate?: () => void;
  /** When true, spectate button is hidden/disabled (player is currently in a match) */
  spectateDisabled?: boolean;
  /** Escape overlay while already in a match */
  escapeOverlay?: boolean;
  onResume?: () => void;
  onAdminSettings?: (ctx: { name: string; password: string }) => void;
  onOpenSkins?: () => void;
  onOpenSettings?: () => void;
  connectionError?: string | null;
  isConnecting?: boolean;
  roomPlayers?: number | null;
  roomLobby?: number | null;
}

export function StartScreen({
  name,
  onNameChange,
  password,
  onPasswordChange,
  onStart,
  onSpectate,
  spectateDisabled = false,
  escapeOverlay = false,
  onResume,
  onAdminSettings,
  onOpenSkins,
  onOpenSettings,
  connectionError,
  isConnecting,
  roomPlayers = null,
  roomLobby = null,
}: StartScreenProps) {
  const [localError, setLocalError] = useState<string | null>(null);
  const adminName = isAdminName(name);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (escapeOverlay && onResume) {
      onResume();
      return;
    }
    if (!name.trim() || isConnecting) return;
    setLocalError(null);
    if (adminName && password !== ADMIN_PASSWORD) {
      setLocalError('Неверный пароль');
      return;
    }
    onStart(name.trim(), resolveServerUrl(), adminName ? password : undefined);
  };

  const stopKeys = (e: React.KeyboardEvent) => {
    e.stopPropagation();
  };

  return (
    <div className="absolute inset-0 flex items-center justify-center p-4 pointer-events-none z-50">
      <div
        className="bg-black/70 backdrop-blur-lg rounded-2xl p-8 max-w-md w-full border border-white/20 pointer-events-auto"
        onKeyDown={stopKeys}
        onKeyUp={stopKeys}
      >
        <div className="text-center mb-6">
          <h1 className="text-6xl font-bold text-white mb-2 tracking-wider">
            <span className="text-red-500">А</span>
            <span className="text-yellow-500">Г</span>
            <span className="text-green-500">А</span>
            <span className="text-blue-500">Р</span>
            <span className="text-purple-500">В</span>
            <span className="text-pink-500">А</span>
          </h1>
        </div>

        <div className="mb-4">
          <div className="w-full py-2 rounded-lg font-semibold text-center bg-sky-600 text-white">
            Классик
            <span className="block text-xs font-normal text-sky-100/90 mt-0.5">
              Игроки: {roomPlayers ?? '—'} · В меню: {roomLobby ?? '—'}
            </span>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            type="text"
            value={name}
            onChange={(e) => {
              onNameChange(e.target.value);
              setLocalError(null);
            }}
            onKeyDown={stopKeys}
            onKeyUp={stopKeys}
            placeholder="Введите ваш никнейм"
            maxLength={15}
            autoComplete="username"
            className="w-full px-4 py-3 rounded-lg bg-white/10 border border-white/20 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
          />

          {adminName && (
            <input
              type="password"
              value={password}
              onChange={(e) => {
                onPasswordChange(e.target.value);
                setLocalError(null);
              }}
              onKeyDown={stopKeys}
              onKeyUp={stopKeys}
              placeholder="Пароль"
              autoComplete="current-password"
              className="w-full px-4 py-3 rounded-lg bg-white/10 border border-amber-400/40 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent"
            />
          )}

          {(localError || connectionError) && (
            <div className="text-red-400 text-sm bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
              {localError || connectionError}
            </div>
          )}

          <button
            type="submit"
            disabled={
              escapeOverlay
                ? false
                : !name.trim() || isConnecting || (adminName && !password)
            }
            className="w-full py-3 rounded-lg bg-gradient-to-r from-green-500 to-emerald-600 text-white font-bold text-lg hover:from-green-600 hover:to-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all transform hover:scale-[1.02]"
          >
            {escapeOverlay
              ? '▶ Продолжить'
              : isConnecting
                ? 'Подключение…'
                : '▶ Войти в комнату'}
          </button>

          <div className="grid grid-cols-3 gap-2">
            {onOpenSettings && (
              <button
                type="button"
                onClick={onOpenSettings}
                className="py-3 rounded-lg bg-white/10 border border-white/20 text-white font-bold text-sm hover:bg-white/20 transition-all"
              >
                Настройки
              </button>
            )}
            {onSpectate && !spectateDisabled ? (
              <button
                type="button"
                onClick={onSpectate}
                className="py-3 rounded-lg bg-white/10 border border-white/20 text-white font-bold text-sm hover:bg-white/20 transition-all"
              >
                Наблюдать
              </button>
            ) : (
              <button
                type="button"
                disabled
                className="py-3 rounded-lg bg-white/5 border border-white/10 text-gray-500 font-bold text-sm cursor-not-allowed"
              >
                Наблюдать
              </button>
            )}
            {onOpenSkins && (
              <button
                type="button"
                onClick={onOpenSkins}
                className="py-3 rounded-lg bg-fuchsia-500/20 border border-fuchsia-400/40 text-fuchsia-100 font-bold text-sm hover:bg-fuchsia-500/30 transition-all"
              >
                Скины
              </button>
            )}
          </div>

          {onAdminSettings && adminName && (
            <button
              type="button"
              onClick={() => {
                if (password !== ADMIN_PASSWORD) {
                  setLocalError('Неверный пароль');
                  return;
                }
                onAdminSettings({ name: name.trim(), password });
              }}
              className="w-full py-3 rounded-lg bg-amber-500/20 border border-amber-400/40 text-amber-200 font-bold text-lg hover:bg-amber-500/30 transition-all"
            >
              Настройки salruz
            </button>
          )}
        </form>
      </div>
    </div>
  );
}

/** Lightweight WS watcher for menu room counts */
export function useRoomStats(active: boolean): { players: number | null; lobby: number | null } {
  const [players, setPlayers] = useState<number | null>(null);
  const [lobby, setLobby] = useState<number | null>(null);

  useEffect(() => {
    if (!active) return;
    let ws: WebSocket | null = null;
    let closed = false;
    try {
      ws = new WebSocket(resolveServerUrl());
    } catch {
      return;
    }
    ws.onopen = () => {
      if (closed) return;
      ws?.send(JSON.stringify({ type: 'lobby' }));
    };
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(String(ev.data)) as {
          type: string;
          players?: number;
          lobby?: number;
        };
        if (msg.type === 'roomInfo') {
          setPlayers(typeof msg.players === 'number' ? msg.players : 0);
          setLobby(typeof msg.lobby === 'number' ? msg.lobby : 0);
        }
      } catch {
        /* ignore */
      }
    };
    return () => {
      closed = true;
      try {
        ws?.close();
      } catch {
        /* ignore */
      }
    };
  }, [active]);

  return { players, lobby };
}
