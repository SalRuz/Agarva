import { useState, useEffect } from 'react';
import { resolveServerUrl } from '../net/MultiplayerClient';
import { isAdminName } from '../../shared/physics';
import { ADMIN_PASSWORD } from '../../shared/constants';
import type { SkinInfo } from '../skins/loadSkins';

export type PlayRoomMode = 'classic' | 'soloFight' | 'duoFight' | 'trioFight';

export type SoloFightTopEntry = { name: string; score: number };
export type ModeTopEntry = SoloFightTopEntry;
export type LobbyRoomStats = {
  players: number | null;
  spectators: number | null;
  blue: number | null;
  red: number | null;
  blueMembers: string[];
  redMembers: string[];
};
export type LobbyStatsByMode = Record<PlayRoomMode, LobbyRoomStats>;

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
  onToggleFullscreen?: () => void;
  connectionError?: string | null;
  isConnecting?: boolean;
  roomPlayers?: number | null;
  /** Spectators watching this mode (not menu lobby) */
  roomSpectators?: number | null;
  roomBlue?: number | null;
  roomRed?: number | null;
  roomBlueMembers?: string[];
  roomRedMembers?: string[];
  /** Complete, server-authored snapshot for every mode preview card. */
  lobbyStats?: LobbyStatsByMode;
  /** Weekly rankings supplied for all game modes. */
  modeTops?: Record<PlayRoomMode, ModeTopEntry[]>;
  weeklyTopEndsAt?: Partial<Record<PlayRoomMode, number>>;
  weeklyTopPrizes?: Partial<Record<PlayRoomMode, number>>;
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
  onRequestPasswordReset?: (login: string) => void;
  onConfirmPasswordReset?: (login: string, code: string, newPassword: string) => void;
  passwordResetError?: string | null;
  passwordResetNotice?: string | null;
  passwordResetBusy?: boolean;
  passwordResetCodeSent?: boolean;
  questLevel?: number;
  questXpIntoLevel?: number;
  questXpPerLevel?: number;
  questAgarviki?: number;
  questTitle?: string;
  questProgressText?: string;
  showQuestHud?: boolean;
  onToggleShowQuestHud?: (next: boolean) => void;
  claimedLevelRewards?: number[];
  /** Built-in and admin-added skins awarded for each level. */
  levelSkinRewards?: Record<number, SkinInfo[]>;
  telegramChannelUrl?: string;
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
  onToggleFullscreen,
  connectionError,
  isConnecting,
  roomPlayers = null,
  roomSpectators = null,
  roomBlue = null,
  roomRed = null,
  roomBlueMembers = [],
  roomRedMembers = [],
  lobbyStats,
  modeTops,
  weeklyTopEndsAt,
  weeklyTopPrizes,
  skinPreviewUrl = null,
  accountLogin = null,
  onRegisterAccount,
  registerError = null,
  registerBusy = false,
  onLoginAccount,
  loginError = null,
  loginBusy = false,
  onRequestPasswordReset,
  onConfirmPasswordReset,
  passwordResetError = null,
  passwordResetNotice = null,
  passwordResetBusy = false,
  passwordResetCodeSent = false,
  questLevel = 1,
  questXpIntoLevel = 0,
  questXpPerLevel = 100,
  questAgarviki = 0,
  questTitle = 'Задание',
  questProgressText = '—',
  showQuestHud = false,
  onToggleShowQuestHud,
  claimedLevelRewards = [],
  levelSkinRewards = {},
  telegramChannelUrl = '',
}: StartScreenProps) {
  const [localError, setLocalError] = useState<string | null>(null);
  const [regOpen, setRegOpen] = useState(false);
  const [regLogin, setRegLogin] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [regLocalError, setRegLocalError] = useState<string | null>(null);
  const [loginOpen, setLoginOpen] = useState(false);
  const [loginLogin, setLoginLogin] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginLocalError, setLoginLocalError] = useState<string | null>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetLogin, setResetLogin] = useState('');
  const [resetCode, setResetCode] = useState('');
  const [resetPassword, setResetPassword] = useState('');
  const [resetLocalError, setResetLocalError] = useState<string | null>(null);
  const [showLevelRewards, setShowLevelRewards] = useState(false);
  const adminName = isAdminName(name);
  const questXpPercent = questXpPerLevel > 0 ? (questXpIntoLevel / questXpPerLevel) * 100 : 0;
  const levelReward = (level: number) => {
    const skins = levelSkinRewards[level] ?? [];
    return skins.length
      ? `10 агарвиков + ${skins.map((skin) => `скин «${skin.name}»`).join(', ')}`
      : '10 агарвиков';
  };
  const statsFor = (mode: PlayRoomMode): LobbyRoomStats =>
    lobbyStats?.[mode] ?? {
      players: mode === playMode ? roomPlayers : null,
      spectators: mode === playMode ? roomSpectators : null,
      blue: mode === playMode ? roomBlue : null,
      red: mode === playMode ? roomRed : null,
      blueMembers: mode === playMode ? roomBlueMembers : [],
      redMembers: mode === playMode ? roomRedMembers : [],
    };
  const topFor = (mode: PlayRoomMode) => modeTops?.[mode] ?? [];
  const formatUntilReset = (endsAt?: number) => {
    if (!endsAt) return '—';
    const seconds = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
    const days = Math.floor(seconds / 86_400);
    const hours = Math.floor((seconds % 86_400) / 3_600);
    const minutes = Math.floor((seconds % 3_600) / 60);
    return `${days}д ${String(hours).padStart(2, '0')}ч ${String(minutes).padStart(2, '0')}м`;
  };

  useEffect(() => {
    if (passwordResetCodeSent) setResetOpen(true);
  }, [passwordResetCodeSent]);

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

  const submitPasswordReset = (e: React.FormEvent) => {
    e.preventDefault();
    setResetLocalError(null);
    if (!/^[a-zA-Z0-9]{1,15}$/.test(resetLogin.trim())) {
      setResetLocalError('Логин: только латинские буквы и цифры');
      return;
    }
    if (!passwordResetCodeSent) {
      onRequestPasswordReset?.(resetLogin.trim());
      return;
    }
    if (!/^\d{4}$/.test(resetCode)) {
      setResetLocalError('Введите 4-значный код');
      return;
    }
    if (!resetPassword || resetPassword.length > 8) {
      setResetLocalError('Пароль: максимум 8 символов');
      return;
    }
    onConfirmPasswordReset?.(resetLogin.trim(), resetCode, resetPassword);
  };

  return (
    <div className="absolute inset-0 overflow-y-auto flex items-start sm:items-center justify-center p-3 sm:p-4 pointer-events-none z-50">
      <div className="flex w-full max-w-5xl flex-col items-stretch justify-center gap-3 sm:gap-4 lg:flex-row">
        <div className="pointer-events-auto w-full lg:w-[172px] shrink-0 flex flex-col items-center gap-3 self-start lg:mt-4 rounded-2xl border border-white/20 bg-black/70 backdrop-blur-lg p-3 shadow-lg">
          <div className="relative w-[112px] h-[112px] flex items-center justify-center">
            <div
              className="absolute inset-0 rounded-full"
              style={{
                background: `conic-gradient(#38bdf8 ${Math.max(0, Math.min(100, questXpPercent))}%, rgba(255,255,255,0.12) 0)`,
                WebkitMask: 'radial-gradient(farthest-side, transparent calc(100% - 7px), #000 calc(100% - 6px))',
                mask: 'radial-gradient(farthest-side, transparent calc(100% - 7px), #000 calc(100% - 6px))',
              }}
              title={`Опыт: ${questXpIntoLevel}/${questXpPerLevel}`}
            />
            <div className="w-[100px] h-[100px] rounded-full overflow-hidden border-2 border-white/25 bg-gradient-to-br from-emerald-400 to-sky-500 shadow-lg relative z-[1]">
              {skinPreviewUrl ? (
                <img src={skinPreviewUrl} alt="" className="w-full h-full object-cover" />
              ) : null}
            </div>
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
          ) : resetOpen ? (
            <form onSubmit={submitPasswordReset} className="w-full space-y-2" onKeyDown={stopKeys} onKeyUp={stopKeys}>
              <input
                value={resetLogin}
                onChange={(e) => setResetLogin(e.target.value)}
                placeholder="Логин"
                maxLength={15}
                autoComplete="username"
                disabled={passwordResetCodeSent}
                className="w-full px-2 py-1.5 rounded bg-black/60 border border-white/20 text-white text-xs disabled:opacity-60"
              />
              {passwordResetCodeSent && (
                <>
                  <input
                    value={resetCode}
                    onChange={(e) => setResetCode(e.target.value.replace(/\D/g, '').slice(0, 4))}
                    placeholder="Код из Telegram"
                    inputMode="numeric"
                    maxLength={4}
                    className="w-full px-2 py-1.5 rounded bg-black/60 border border-white/20 text-white text-xs"
                  />
                  <input
                    type="password"
                    value={resetPassword}
                    onChange={(e) => setResetPassword(e.target.value)}
                    placeholder="Новый пароль"
                    maxLength={8}
                    autoComplete="new-password"
                    className="w-full px-2 py-1.5 rounded bg-black/60 border border-white/20 text-white text-xs"
                  />
                </>
              )}
              {(resetLocalError || passwordResetError) && (
                <div className="text-[10px] text-red-300 leading-tight">{resetLocalError || passwordResetError}</div>
              )}
              {passwordResetNotice && <div className="text-[10px] text-emerald-300 leading-tight">{passwordResetNotice}</div>}
              <button
                type="submit"
                disabled={passwordResetBusy}
                className="w-full py-1.5 rounded bg-violet-600 text-white text-xs font-semibold disabled:opacity-50"
              >
                {passwordResetBusy ? '…' : passwordResetCodeSent ? 'Сменить пароль' : 'Получить код'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setResetOpen(false);
                  setResetLocalError(null);
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
              <button
                type="button"
                onClick={() => {
                  setLoginOpen(false);
                  setResetOpen(true);
                  setResetLocalError(null);
                }}
                className="w-full py-1 text-sky-200 text-[10px] underline underline-offset-2"
              >
                Забыл пароль
              </button>
            </form>
          ) : (
            <div className="grid w-full grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => {
                  setRegOpen(true);
                  setRegLocalError(null);
                }}
                className="min-w-0 px-1 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-white text-xs font-semibold border border-white/20"
              >
                Регистрация
              </button>
              <button
                type="button"
                onClick={() => {
                  setLoginOpen(true);
                  setLoginLocalError(null);
                }}
                className="min-w-0 px-1 py-2 rounded-lg bg-sky-500/20 hover:bg-sky-500/30 text-sky-100 text-xs font-semibold border border-sky-300/30"
              >
                Вход
              </button>
            </div>
          )}
          {accountLogin ? (
            <>
              <div className="w-full rounded-xl border border-white/10 bg-black/30 px-2 py-2 text-center">
                <div className="text-white text-xs font-semibold">Уровень {questLevel}</div>
                <div className="text-amber-200/90 text-[11px] mt-0.5">Агарвики: {questAgarviki}</div>
              </div>
              <div className="w-full rounded-xl border border-white/10 bg-black/30 px-2 py-2">
                <div className="text-[10px] text-slate-300 uppercase tracking-wide mb-1">Задание</div>
                <div className="text-white text-[11px] font-medium leading-snug">{questTitle}</div>
                <div className="text-sky-200 text-[11px] mt-1 leading-snug">{questProgressText}</div>
                <button
                  type="button"
                  onClick={() => onToggleShowQuestHud?.(!showQuestHud)}
                  className={`mt-2 w-full py-1.5 rounded-lg text-[10px] font-semibold border transition ${
                    showQuestHud
                      ? 'bg-emerald-600/80 border-emerald-300/40 text-white'
                      : 'bg-white/10 border-white/15 text-slate-200 hover:bg-white/15'
                  }`}
                >
                  {showQuestHud ? 'Задание в игре: вкл' : 'Отображать задание'}
                </button>
              </div>
            </>
          ) : (
            <div className="w-full rounded-xl border border-white/10 bg-black/30 px-2 py-2 text-[10px] text-slate-400 leading-snug">
              Войдите в аккаунт, чтобы получать задания, опыт и Агарвики.
            </div>
          )}
          {accountLogin && (
            <button
              type="button"
              onClick={() => setShowLevelRewards(true)}
              className="w-full py-2 rounded-lg text-[10px] font-semibold border bg-amber-500/15 border-amber-300/30 text-amber-100 hover:bg-amber-500/25"
            >
              Просмотр награждений за уровни
            </button>
          )}
        </div>

        <div
          className="bg-black/70 backdrop-blur-lg rounded-2xl p-4 sm:p-8 max-w-md w-full border border-white/20 pointer-events-auto"
          onKeyDown={stopKeys}
          onKeyUp={stopKeys}
        >
          <div className="text-center mb-6">
            <h1 className="text-4xl sm:text-6xl font-bold text-white mb-2 tracking-wider">
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
              <span className="block text-xs font-normal text-sky-100/90 mt-0.5">Игроки: {statsFor('classic').players ?? '—'} · Спеки: {statsFor('classic').spectators ?? '—'}</span>
            </button>
            <button
              type="button"
              onClick={() => onPlayModeChange('soloFight')}
              className={`flex-1 py-2 rounded-lg font-semibold transition-all ${
                playMode === 'soloFight' ? 'bg-rose-600 text-white' : 'bg-white/10 text-gray-300 hover:bg-white/15'
              }`}
            >
              Соло файт
              <span className="block text-xs font-normal text-rose-100/90 mt-0.5">Бой: {statsFor('soloFight').players ?? '—'} / 2 · Спеки: {statsFor('soloFight').spectators ?? '—'}</span>
            </button>
            <button
              type="button"
              onClick={() => onPlayModeChange('duoFight')}
              className={`py-2 rounded-lg font-semibold transition-all ${playMode === 'duoFight' ? 'bg-blue-600 text-white' : 'bg-white/10 text-gray-300 hover:bg-white/15'}`}
            >
              Дуо файт
              <span className="block text-xs font-normal text-blue-100/90 mt-0.5">Бой: {statsFor('duoFight').players ?? '—'} / 4 · Спеки: {statsFor('duoFight').spectators ?? '—'}</span>
            </button>
            <button
              type="button"
              onClick={() => onPlayModeChange('trioFight')}
              className={`py-2 rounded-lg font-semibold transition-all ${playMode === 'trioFight' ? 'bg-violet-600 text-white' : 'bg-white/10 text-gray-300 hover:bg-white/15'}`}
            >
              Трио файт
              <span className="block text-xs font-normal text-violet-100/90 mt-0.5">Бой: {statsFor('trioFight').players ?? '—'} / 6 · Спеки: {statsFor('trioFight').spectators ?? '—'}</span>
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

            {(playMode === 'duoFight' || playMode === 'trioFight') && (
              <div className="rounded-lg border border-white/20 bg-white/5 p-3 space-y-2">
                <div className="text-center text-sm text-white font-semibold">Выберите команду · Спектаторы: {roomSpectators ?? '—'}</div>
                <div className="grid grid-cols-2 gap-2">
                  <button type="button" disabled={(roomBlue ?? 0) >= (playMode === 'duoFight' ? 2 : 3)} onClick={() => joinTeam('blue')} className="min-w-0 rounded bg-blue-600 px-2 py-2 text-white disabled:opacity-40">
                    <span className="block">Синяя {roomBlue ?? 0}/{playMode === 'duoFight' ? 2 : 3}</span>
                    <span className="mt-1 flex flex-col gap-0.5 whitespace-normal break-words text-left text-xs font-normal leading-4">
                      {roomBlueMembers.length ? roomBlueMembers.map((nick) => <span key={nick} className="block">{nick}</span>) : 'Свободно'}
                    </span>
                  </button>
                  <button type="button" disabled={(roomRed ?? 0) >= (playMode === 'duoFight' ? 2 : 3)} onClick={() => joinTeam('red')} className="min-w-0 rounded bg-red-600 px-2 py-2 text-white disabled:opacity-40">
                    <span className="block">Красная {roomRed ?? 0}/{playMode === 'duoFight' ? 2 : 3}</span>
                    <span className="mt-1 flex flex-col gap-0.5 whitespace-normal break-words text-left text-xs font-normal leading-4">
                      {roomRedMembers.length ? roomRedMembers.map((nick) => <span key={nick} className="block">{nick}</span>) : 'Свободно'}
                    </span>
                  </button>
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-2">
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
              <button
                type="button"
                onClick={onToggleFullscreen}
                className="py-3 rounded-lg bg-white/10 border border-white/20 text-white font-bold text-sm hover:bg-white/20 transition-all"
              >
                На весь экран
              </button>
            </div>
            {telegramChannelUrl.trim() && (
              <a
                href={telegramChannelUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-2 block w-full rounded-lg border border-sky-200/50 bg-gradient-to-r from-sky-500 to-blue-600 px-3 py-3 text-center text-sm font-bold text-white shadow-lg transition hover:from-sky-400 hover:to-blue-500"
              >
                ✈ Перейти в телеграм канал игры
              </a>
            )}

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

        <div className="bg-black/70 backdrop-blur-lg rounded-2xl p-4 sm:p-5 w-full lg:w-56 shrink-0 border border-rose-500/30 pointer-events-auto flex flex-col">
            <div className="text-rose-300 font-bold text-sm tracking-wide mb-1">ТОП {playMode === 'classic' ? 'КЛАССИКА' : playMode === 'soloFight' ? 'СОЛО' : playMode === 'duoFight' ? 'ДУО' : 'ТРИО'} </div>
            <div className="text-slate-400 text-xs mb-1">{playMode === 'classic' ? 'Лучший рекорд массы' : 'Всего побед'}</div>
            <div className="text-amber-200 text-[10px] mb-3">Сброс и награда {weeklyTopPrizes?.[playMode] ?? 60} агарвиков: {formatUntilReset(weeklyTopEndsAt?.[playMode])}</div>
            <ul className="space-y-1 overflow-y-auto max-h-[420px] text-sm">
              {topFor(playMode).length === 0 ? (
                <li className="text-slate-500 text-xs py-2">Пока нет результатов</li>
              ) : (
                topFor(playMode).map((entry, index) => (
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
      </div>
      {showLevelRewards && (
        <div className="absolute inset-0 z-[60] flex items-center justify-center bg-black/75 p-4 pointer-events-auto">
          <div className="w-full max-w-xl rounded-2xl border border-amber-300/30 bg-slate-950 p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-xl font-bold text-white">Награды за уровни</h2>
                <p className="mt-1 text-xs text-slate-300">Ближайшие 10 уровней: окно сдвигается после каждого нового уровня.</p>
              </div>
              <button type="button" onClick={() => setShowLevelRewards(false)} className="rounded-lg bg-white/10 px-3 py-1.5 text-sm text-white">Закрыть</button>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
              {Array.from({ length: 10 }, (_, i) => questLevel + i + 1).map((level) => {
                const claimed = claimedLevelRewards.includes(level);
                const skins = levelSkinRewards[level] ?? [];
                return (
                  <div key={level} className={`min-h-24 rounded-xl border p-3 text-xs ${claimed ? 'border-emerald-400/40 bg-emerald-500/10' : 'border-white/15 bg-white/5'}`}>
                    <div className="font-bold text-white">Уровень {level}</div>
                    <div className="mt-2 text-amber-200">{levelReward(level)}</div>
                    {skins.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {skins.map((skin) => (
                          <div key={skin.id} className="flex items-center gap-1 text-[10px] text-slate-200">
                            {skin.url && <img src={skin.url} alt="" className="h-6 w-6 rounded-full object-cover" />}
                            <span className="max-w-20 truncate" title={skin.name}>{skin.name}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    <div className={`mt-2 text-[10px] ${claimed ? 'text-emerald-300' : 'text-slate-400'}`}>{claimed ? 'Получено' : 'Впереди'}</div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** One persistent menu observer. `lobbySnapshot` always includes all room keys,
 * so state is updated atomically and no mode can bleed into another card. */
export function useLobbySnapshot(active: boolean): LobbyStatsByMode {
  const empty = (): LobbyRoomStats => ({
    players: null, spectators: null, blue: null, red: null, blueMembers: [], redMembers: [],
  });
  const [stats, setStats] = useState<LobbyStatsByMode>({
    classic: empty(), soloFight: empty(), duoFight: empty(), trioFight: empty(),
  });
  useEffect(() => {
    if (!active) return;
    let closed = false;
    let socket: WebSocket | null = null;
    try {
      socket = new WebSocket(resolveServerUrl());
      socket.onopen = () => socket?.send(JSON.stringify({ type: 'lobby', mode: 'classic' }));
      socket.onmessage = (event) => {
        try {
          const message = JSON.parse(String(event.data)) as {
            type?: string;
            rooms?: Record<PlayRoomMode, { players: number; lobby: number; blue?: number; red?: number; blueMembers?: string[]; redMembers?: string[] }>;
          };
          if (closed || message.type !== 'lobbySnapshot' || !message.rooms) return;
          setStats({
            classic: toLobbyStats(message.rooms.classic),
            soloFight: toLobbyStats(message.rooms.soloFight),
            duoFight: toLobbyStats(message.rooms.duoFight),
            trioFight: toLobbyStats(message.rooms.trioFight),
          });
        } catch { /* malformed network frame */ }
      };
    } catch { /* connection errors leave unavailable stats as dashes */ }
    return () => {
      closed = true;
      socket?.close();
    };
  }, [active]);
  return stats;
}

/** Single menu observer for weekly rankings and server reset deadlines. */
export function useModeTops(active: boolean): {
  tops: Record<PlayRoomMode, ModeTopEntry[]>;
  weeklyEndsAt: Partial<Record<PlayRoomMode, number>>;
} {
  const empty = (): Record<PlayRoomMode, ModeTopEntry[]> => ({
    classic: [], soloFight: [], duoFight: [], trioFight: [],
  });
  const [tops, setTops] = useState(empty);
  const [weeklyEndsAt, setWeeklyEndsAt] = useState<Partial<Record<PlayRoomMode, number>>>({});
  useEffect(() => {
    if (!active) return;
    let socket: WebSocket | null = null;
    try {
      socket = new WebSocket(resolveServerUrl());
      socket.onopen = () => socket?.send(JSON.stringify({ type: 'lobby', mode: 'classic' }));
      socket.onmessage = (event) => {
        try {
          const message = JSON.parse(String(event.data)) as {
            type?: string;
            tops?: Record<PlayRoomMode, ModeTopEntry[]>;
            weeklyTopEndsAt?: Partial<Record<PlayRoomMode, number>>;
          };
          if (message.type !== 'lobbySnapshot') return;
          if (message.tops) setTops({ ...empty(), ...message.tops });
          if (message.weeklyTopEndsAt) setWeeklyEndsAt(message.weeklyTopEndsAt);
        } catch { /* malformed frame */ }
      };
    } catch { /* unavailable server leaves empty rankings */ }
    return () => socket?.close();
  }, [active]);
  return { tops, weeklyEndsAt };
}

function toLobbyStats(room: { players: number; lobby: number; blue?: number; red?: number; blueMembers?: string[]; redMembers?: string[] }): LobbyRoomStats {
  return {
    players: room.players,
    spectators: room.lobby,
    blue: room.blue ?? null,
    red: room.red ?? null,
    blueMembers: Array.isArray(room.blueMembers) ? room.blueMembers : [],
    redMembers: Array.isArray(room.redMembers) ? room.redMembers : [],
  };
}

/** Legacy per-room observer kept for compatibility with external consumers. */
export function useRoomStats(
  active: boolean,
  mode: PlayRoomMode = 'classic'
): { players: number | null; spectators: number | null; blue: number | null; red: number | null; blueMembers: string[]; redMembers: string[]; soloFightTop: SoloFightTopEntry[] } {
  type RoomStats = {
    players: number | null;
    spectators: number | null;
    blue: number | null;
    red: number | null;
    blueMembers: string[];
    redMembers: string[];
    soloFightTop: SoloFightTopEntry[];
  };
  const emptyStats = (): RoomStats => ({
    players: null, spectators: null, blue: null, red: null, blueMembers: [], redMembers: [], soloFightTop: [],
  });
  const [statsByMode, setStatsByMode] = useState<Record<PlayRoomMode, RoomStats>>({
    classic: emptyStats(),
    soloFight: emptyStats(),
    duoFight: emptyStats(),
    trioFight: emptyStats(),
  });

  useEffect(() => {
    if (!active) return;
    const modes: PlayRoomMode[] = ['classic', 'soloFight', 'duoFight', 'trioFight'];
    setStatsByMode({
      classic: emptyStats(),
      soloFight: emptyStats(),
      duoFight: emptyStats(),
      trioFight: emptyStats(),
    });
    let closed = false;
    const sockets = modes.flatMap((watchMode) => {
      let ws: WebSocket;
      try {
        ws = new WebSocket(resolveServerUrl());
      } catch {
        return [];
      }
      ws.onopen = () => {
        if (!closed) ws.send(JSON.stringify({ type: 'lobby', mode: watchMode }));
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
            blueMembers?: string[];
            redMembers?: string[];
            mode?: PlayRoomMode;
            entries?: SoloFightTopEntry[];
          };
          if (msg.type === 'roomInfo' && msg.mode === watchMode) {
            setStatsByMode((previous) => ({
              ...previous,
              [watchMode]: {
                ...previous[watchMode],
                players: typeof msg.players === 'number' ? msg.players : 0,
                spectators: typeof msg.spectators === 'number' ? msg.spectators : typeof msg.lobby === 'number' ? msg.lobby : 0,
                blue: typeof msg.blue === 'number' ? msg.blue : null,
                red: typeof msg.red === 'number' ? msg.red : null,
                blueMembers: Array.isArray(msg.blueMembers) ? msg.blueMembers : [],
                redMembers: Array.isArray(msg.redMembers) ? msg.redMembers : [],
              },
            }));
          }
          if (msg.type === 'soloFightTop' && watchMode === 'soloFight') {
            setStatsByMode((previous) => ({
              ...previous,
              soloFight: { ...previous.soloFight, soloFightTop: Array.isArray(msg.entries) ? msg.entries : [] },
            }));
          }
          if (msg.type === 'teamFightTop' && (watchMode === 'duoFight' || watchMode === 'trioFight')) {
            setStatsByMode((previous) => ({
              ...previous,
              [watchMode]: { ...previous[watchMode], soloFightTop: Array.isArray(msg.entries) ? msg.entries : [] },
            }));
          }
        } catch {
          /* ignore */
        }
      };
      return [ws];
    });
    return () => {
      closed = true;
      for (const ws of sockets) {
        try {
          ws.close();
        } catch {
          /* ignore */
        };
      }
    };
  }, [active]);

  return statsByMode[mode];
}
