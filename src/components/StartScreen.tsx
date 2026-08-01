import { useState, useEffect } from 'react';
import { resolveServerUrl } from '../net/MultiplayerClient';
import { isAdminName } from '../../shared/physics';
import { ADMIN_PASSWORD } from '../../shared/constants';

export type PlayRoomMode = 'classic' | 'soloFight' | 'duoFight' | 'trioFight';

export type SoloFightTopEntry = { name: string; score: number };

interface StartScreenProps {
  name: string;
  onNameChange: (name: string) => void;
  password: string;
  onPasswordChange: (password: string) => void;
  playMode: PlayRoomMode;
  onPlayModeChange: (mode: PlayRoomMode) => void;
  onStart: (name: string, serverUrl: string, password?: string, mode?: PlayRoomMode, team?: 'blue' | 'red') => void;
  onSpectate?: (mode: PlayRoomMode) => void;
  /** When true, spectate button is hidden/disabled (player is currently in a match) */
  spectateDisabled?: boolean;
  /** Escape overlay while already in a match */
  escapeOverlay?: boolean;
  /** Mode the player is currently connected to (for force-switch) */
  activePlayMode?: PlayRoomMode;
  onResume?: () => void;
  onAdminSettings?: (ctx: { name: string; password: string }) => void;
  onOpenSkins?: () => void;
  onOpenSettings?: () => void;
  connectionError?: string | null;
  isConnecting?: boolean;
  roomPlayers?: number | null;
  /** Spectators watching this mode (not menu lobby) */
  roomSpectators?: number | null;
  roomBlue?: number | null;
  roomRed?: number | null;
  /** Fight total-wins leaderboard (shown beside menu) */
  soloFightTop?: SoloFightTopEntry[];
  /** Selected skin preview URL (null = plain ball) */
  skinPreviewUrl?: string | null;
  /** Registered profile login (locked to device) */
  accountLogin?: string | null;
  onRegisterAccount?: (login: string, password: string) => void;
  registerError?: string | null;
  registerBusy?: boolean;
  onLoginAccount?: (login: string, password: string) => void;
  loginError?: string | null;
  loginBusy?: boolean;
}

export function StartScreen({
  name,
  onNameChange,
  password,
  onPasswordChange,
  playMode,
  onPlayModeChange,
  onStart,
  onSpectate,
  spectateDisabled = false,
  escapeOverlay = false,
  activePlayMode,
  onResume,
  onAdminSettings,
  onOpenSkins,
  onOpenSettings,
  connectionError,
  isConnecting,
  roomPlayers = null,
  roomSpectators = null,
  roomBlue = null,
  roomRed = null,
  soloFightTop = [],
  skinPreviewUrl = null,
  accountLogin = null,
  onRegisterAccount,
  registerError = null,
  registerBusy = false,
  onLoginAccount,
  loginError = null,
  loginBusy = false,
}: StartScreenProps) {
  const [localError, setLocalError] = useState<string | null>(null);
  const [teamPicking, setTeamPicking] = useState(false);
  const [regOpen, setRegOpen] = useState(false);
  const [regLogin, setRegLogin] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [regLocalError, setRegLocalError] = useState<string | null>(null);
  const [loginOpen, setLoginOpen] = useState(false);
  const [loginLogin, setLoginLogin] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginLocalError, setLoginLocalError] = useState<string | null>(null);
  const adminName = isAdminName(name);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const switchingMode = escapeOverlay && activePlayMode && activePlayMode !== playMode;
    if (escapeOverlay && onResume && !switchingMode) {
      onResume();
      return;
    }
    if (!name.trim() || isConnecting) return;
    setLocalError(null);
    if (adminName && password !== ADMIN_PASSWORD) {
      setLocalError('Неверный пароль');
      return;
    }
    if (playMode === 'duoFight' || playMode === 'trioFight') {
      setTeamPicking(true);
      return;
    }
    onStart(name.trim(), resolveServerUrl(), adminName ? password : undefined, playMode);
  };

  const joinTeam = (team: 'blue' | 'red') => {
    if (!name.trim() || isConnecting) return;
    onStart(name.trim(), resolveServerUrl(), adminName ? password : undefined, playMode, team);
  };

  const stopKeys = (e: React.KeyboardEvent) => {
    e.stopPropagation();
  };

  const submitRegister = (e: React.FormEvent) => {
    e.preventDefault();
    setRegLocalError(null);
    if (!/^[a-zA-Z0-9]+$/.test(regLogin.trim())) {
      setRegLocalError('Логин: только латинские буквы и цифры');
      return;
    }
    if (!regPassword || regPassword.length > 8) {
      setRegLocalError('Пароль: максимум 8 символов');
      return;
    }
    onRegisterAccount?.(regLogin.trim(), regPassword);
  };

  const submitLogin = (e: React.FormEvent) => {
    e.preventDefault();
    setLoginLocalError(null);
    if (!/^[a-zA-Z0-9]+$/.test(loginLogin.trim())) {
      setLoginLocalError('Логин: только латинские буквы и цифры');
      return;
    }
    if (!loginPassword || loginPassword.length > 8) {
      setLoginLocalError('Пароль: максимум 8 символов');
      return;
    }
    onLoginAccount?.(loginLogin.trim(), loginPassword);
  };

  return (
    <div className="absolute inset-0 flex items-center justify-center p-4 pointer-events-none z-50">
      <div className="flex items-stretch justify-center gap-4 max-w-full">
        <div className="pointer-events-auto w-[140px] shrink-0 flex flex-col items-center gap-3 self-start mt-10">
          <div className="w-[100px] h-[100px] rounded-full overflow-hidden border-2 border-white/25 bg-gradient-to-br from-emerald-400 to-sky-500 shadow-lg">
            {skinPreviewUrl ? (
              <img src={skinPreviewUrl} alt="" className="w-full h-full object-cover" />
            ) : null}
          </div>
          {accountLogin ? (
            <div className="text-center text-amber-300 font-bold text-sm tracking-wide drop-shadow px-1 break-all">
              {accountLogin}
            </div>
          ) : regOpen ? (
            <form onSubmit={submitRegister} className="w-full space-y-2" onKeyDown={stopKeys} onKeyUp={stopKeys}>
              <input
                value={regLogin}
                onChange={(e) => setRegLogin(e.target.value)}
                placeholder="Логин"
                maxLength={15}
                className="w-full px-2 py-1.5 rounded bg-black/60 border border-white/20 text-white text-xs"
              />
              <input
                type="password"
                value={regPassword}
                onChange={(e) => setRegPassword(e.target.value)}
                placeholder="Пароль"
                maxLength={8}
                className="w-full px-2 py-1.5 rounded bg-black/60 border border-white/20 text-white text-xs"
              />
              {(regLocalError || registerError) && (
                <div className="text-[10px] text-red-300 leading-tight">{regLocalError || registerError}</div>
              )}
              <button
                type="submit"
                disabled={registerBusy}
                className="w-full py-1.5 rounded bg-amber-600 text-white text-xs font-semibold disabled:opacity-50"
              >
                {registerBusy ? '…' : 'Создать'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setRegOpen(false);
                  setRegLocalError(null);
                }}
                className="w-full py-1 rounded bg-white/10 text-gray-300 text-[10px]"
              >
                Отмена
              </button>
            </form>
          ) : loginOpen ? (
            <form onSubmit={submitLogin} className="w-full space-y-2" onKeyDown={stopKeys} onKeyUp={stopKeys}>
              <input
                value={loginLogin}
                onChange={(e) => setLoginLogin(e.target.value)}
                placeholder="Логин"
                maxLength={15}
                autoComplete="username"
                className="w-full px-2 py-1.5 rounded bg-black/60 border border-white/20 text-white text-xs"
              />
              <input
                type="password"
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                placeholder="Пароль"
                maxLength={8}
                autoComplete="current-password"
                className="w-full px-2 py-1.5 rounded bg-black/60 border border-white/20 text-white text-xs"
              />
              {(loginLocalError || loginError) && (
                <div className="text-[10px] text-red-300 leading-tight">{loginLocalError || loginError}</div>
              )}
              <button
                type="submit"
                disabled={loginBusy}
                className="w-full py-1.5 rounded bg-sky-600 text-white text-xs font-semibold disabled:opacity-50"
              >
                {loginBusy ? '…' : 'Войти'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setLoginOpen(false);
                  setLoginLocalError(null);
                }}
                className="w-full py-1 rounded bg-white/10 text-gray-300 text-[10px]"
              >
                Отмена
              </button>
            </form>
          ) : (
            <div className="flex flex-wrap justify-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setRegOpen(true);
                  setRegLocalError(null);
                }}
                className="px-2 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-white text-xs font-semibold border border-white/20"
              >
                Регистрация
              </button>
              <button
                type="button"
                onClick={() => {
                  setLoginOpen(true);
                  setLoginLocalError(null);
                }}
                className="px-3 py-2 rounded-lg bg-sky-500/20 hover:bg-sky-500/30 text-sky-100 text-xs font-semibold border border-sky-300/30"
              >
                Вход
              </button>
            </div>
          )}
        </div>

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

          <div className="mb-4 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => onPlayModeChange('classic')}
              className={`flex-1 py-2 rounded-lg font-semibold transition-all ${
                playMode === 'classic' ? 'bg-sky-600 text-white' : 'bg-white/10 text-gray-300 hover:bg-white/15'
              }`}
            >
              Классик
              {playMode === 'classic' && (
                <span className="block text-xs font-normal text-sky-100/90 mt-0.5">
                  Игроки: {roomPlayers ?? '—'} · Спеки: {roomSpectators ?? '—'}
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() => onPlayModeChange('soloFight')}
              className={`flex-1 py-2 rounded-lg font-semibold transition-all ${
                playMode === 'soloFight' ? 'bg-rose-600 text-white' : 'bg-white/10 text-gray-300 hover:bg-white/15'
              }`}
            >
              Соло файт
              {playMode === 'soloFight' && (
                <span className="block text-xs font-normal text-rose-100/90 mt-0.5">
                  Бой: {roomPlayers ?? '—'} / 2 · Спеки: {roomSpectators ?? '—'}
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() => { setTeamPicking(false); onPlayModeChange('duoFight'); }}
              className={`py-2 rounded-lg font-semibold transition-all ${playMode === 'duoFight' ? 'bg-blue-600 text-white' : 'bg-white/10 text-gray-300 hover:bg-white/15'}`}
            >
              Дуо файт
              {playMode === 'duoFight' && <span className="block text-xs font-normal text-blue-100/90 mt-0.5">Бой: {roomPlayers ?? '—'} / 4 · Спеки: {roomSpectators ?? '—'}</span>}
            </button>
            <button
              type="button"
              onClick={() => { setTeamPicking(false); onPlayModeChange('trioFight'); }}
              className={`py-2 rounded-lg font-semibold transition-all ${playMode === 'trioFight' ? 'bg-violet-600 text-white' : 'bg-white/10 text-gray-300 hover:bg-white/15'}`}
            >
              Трио файт
              {playMode === 'trioFight' && <span className="block text-xs font-normal text-violet-100/90 mt-0.5">Бой: {roomPlayers ?? '—'} / 6 · Спеки: {roomSpectators ?? '—'}</span>}
            </button>
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
                ? activePlayMode && activePlayMode !== playMode
                  ? isConnecting
                    ? 'Подключение…'
                    : '▶ Сменить режим'
                  : '▶ Продолжить'
                : isConnecting
                  ? 'Подключение…'
                  : '▶ Войти в комнату'}
            </button>

            {teamPicking && (playMode === 'duoFight' || playMode === 'trioFight') && (
              <div className="rounded-lg border border-white/20 bg-white/5 p-3 space-y-2">
                <div className="text-center text-sm text-white font-semibold">Выберите команду · Спектаторы: {roomSpectators ?? '—'}</div>
                <div className="grid grid-cols-2 gap-2">
                  <button type="button" disabled={(roomBlue ?? 0) >= (playMode === 'duoFight' ? 2 : 3)} onClick={() => joinTeam('blue')} className="py-2 rounded bg-blue-600 text-white disabled:opacity-40">
                    Синяя команда {roomBlue ?? 0}/{playMode === 'duoFight' ? 2 : 3}
                  </button>
                  <button type="button" disabled={(roomRed ?? 0) >= (playMode === 'duoFight' ? 2 : 3)} onClick={() => joinTeam('red')} className="py-2 rounded bg-red-600 text-white disabled:opacity-40">
                    Красная команда {roomRed ?? 0}/{playMode === 'duoFight' ? 2 : 3}
                  </button>
                </div>
              </div>
            )}

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
                  onClick={() => onSpectate(playMode)}
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

        {playMode !== 'classic' && (
          <div className="bg-black/70 backdrop-blur-lg rounded-2xl p-5 w-56 shrink-0 border border-rose-500/30 pointer-events-auto flex flex-col">
            <div className="text-rose-300 font-bold text-sm tracking-wide mb-1">ТОП {playMode === 'soloFight' ? 'СОЛО' : playMode === 'duoFight' ? 'ДУО' : 'ТРИО'} ФАЙТ</div>
            <div className="text-slate-400 text-xs mb-3">Всего побед</div>
            <ul className="space-y-1 overflow-y-auto max-h-[420px] text-sm">
              {soloFightTop.length === 0 ? (
                <li className="text-slate-500 text-xs py-2">Пока нет результатов</li>
              ) : (
                soloFightTop.map((entry, index) => (
                  <li
                    key={`${entry.name}-${index}`}
                    className="flex items-center justify-between gap-2 text-white px-2 py-1 rounded bg-white/5"
                  >
                    <span className="flex items-center gap-2 min-w-0">
                      <span className="w-5 text-center font-mono text-slate-400 shrink-0">{index + 1}</span>
                      <span className="truncate">{entry.name}</span>
                    </span>
                    <span className="font-mono text-emerald-300 shrink-0">{entry.score}</span>
                  </li>
                ))
              )}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

/** Lightweight WS watcher for menu room counts + solo fight top */
export function useRoomStats(
  active: boolean,
  mode: PlayRoomMode = 'classic'
): { players: number | null; spectators: number | null; blue: number | null; red: number | null; soloFightTop: SoloFightTopEntry[] } {
  const [players, setPlayers] = useState<number | null>(null);
  const [spectators, setSpectators] = useState<number | null>(null);
  const [blue, setBlue] = useState<number | null>(null);
  const [red, setRed] = useState<number | null>(null);
  const [soloFightTop, setSoloFightTop] = useState<SoloFightTopEntry[]>([]);

  useEffect(() => {
    if (!active) return;
    setPlayers(null);
    setSpectators(null);
    setBlue(null);
    setRed(null);
    setSoloFightTop([]);
    let ws: WebSocket | null = null;
    let closed = false;
    try {
      ws = new WebSocket(resolveServerUrl());
    } catch {
      return;
    }
    ws.onopen = () => {
      if (closed) return;
      ws?.send(JSON.stringify({ type: 'lobby', mode }));
    };
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(String(ev.data)) as {
          type: string;
          players?: number;
          lobby?: number;
          spectators?: number;
          blue?: number;
          red?: number;
          mode?: string;
          entries?: SoloFightTopEntry[];
        };
        if (msg.type === 'roomInfo') {
          if (msg.mode !== mode) return;
          setPlayers(typeof msg.players === 'number' ? msg.players : 0);
          const specs =
            typeof msg.spectators === 'number'
              ? msg.spectators
              : typeof msg.lobby === 'number'
                ? msg.lobby
                : 0;
          setSpectators(specs);
          setBlue(typeof msg.blue === 'number' ? msg.blue : null);
          setRed(typeof msg.red === 'number' ? msg.red : null);
        }
        if (msg.type === 'soloFightTop' && mode === 'soloFight') {
          setSoloFightTop(Array.isArray(msg.entries) ? msg.entries : []);
        }
        if (msg.type === 'teamFightTop' && (mode === 'duoFight' || mode === 'trioFight')) {
          setSoloFightTop(Array.isArray(msg.entries) ? msg.entries : []);
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
  }, [active, mode]);

  return { players, spectators, blue, red, soloFightTop };
}
