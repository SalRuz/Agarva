import { useState } from 'react';
import { resolveServerUrl } from '../net/MultiplayerClient';
import { isAdminName } from '../../shared/physics';

export type PlayMode = 'solo' | 'multiplayer';

interface StartScreenProps {
  onStartSolo: (name: string) => void;
  onStartMultiplayer: (name: string, serverUrl: string) => void;
  onSpectate?: () => void;
  onAdminSettings?: (ctx: { name: string; mode: PlayMode }) => void;
  onOpenSkins?: () => void;
  connectionError?: string | null;
  isConnecting?: boolean;
}

export function StartScreen({
  onStartSolo,
  onStartMultiplayer,
  onSpectate,
  onAdminSettings,
  onOpenSkins,
  connectionError,
  isConnecting,
}: StartScreenProps) {
  const [name, setName] = useState('');
  const [mode, setMode] = useState<PlayMode>('solo');
  const adminName = isAdminName(name);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || isConnecting) return;
    if (mode === 'solo') {
      onStartSolo(name.trim());
    } else {
      onStartMultiplayer(name.trim(), resolveServerUrl());
    }
  };

  return (
    <div className="absolute inset-0 flex items-center justify-center p-4 pointer-events-none">
      <div className="bg-black/70 backdrop-blur-lg rounded-2xl p-8 max-w-md w-full border border-white/20 pointer-events-auto">
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

        <div className="flex gap-2 mb-4">
          <button
            type="button"
            onClick={() => setMode('solo')}
            className={`flex-1 py-2 rounded-lg font-semibold transition-all ${
              mode === 'solo'
                ? 'bg-emerald-600 text-white'
                : 'bg-white/10 text-gray-300 hover:bg-white/15'
            }`}
          >
            Solo
          </button>
          <button
            type="button"
            onClick={() => setMode('multiplayer')}
            className={`flex-1 py-2 rounded-lg font-semibold transition-all ${
              mode === 'multiplayer'
                ? 'bg-sky-600 text-white'
                : 'bg-white/10 text-gray-300 hover:bg-white/15'
            }`}
          >
            Мультиплеер
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Введите ваш никнейм"
            maxLength={15}
            className="w-full px-4 py-3 rounded-lg bg-white/10 border border-white/20 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
          />

          {connectionError && (
            <div className="text-red-400 text-sm bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
              {connectionError}
            </div>
          )}

          <button
            type="submit"
            disabled={!name.trim() || isConnecting}
            className="w-full py-3 rounded-lg bg-gradient-to-r from-green-500 to-emerald-600 text-white font-bold text-lg hover:from-green-600 hover:to-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all transform hover:scale-[1.02]"
          >
            {isConnecting ? 'Подключение…' : mode === 'solo' ? '▶ Играть Solo' : '▶ Войти в комнату'}
          </button>
          {onSpectate && (
            <button
              type="button"
              onClick={onSpectate}
              className="w-full py-3 rounded-lg bg-white/10 border border-white/20 text-white font-bold text-lg hover:bg-white/20 transition-all"
            >
              👁 Наблюдать
            </button>
          )}
          {onOpenSkins && (
            <button
              type="button"
              onClick={onOpenSkins}
              className="w-full py-3 rounded-lg bg-fuchsia-500/20 border border-fuchsia-400/40 text-fuchsia-100 font-bold text-lg hover:bg-fuchsia-500/30 transition-all"
            >
              Скины
            </button>
          )}
          {onAdminSettings && adminName && (
            <button
              type="button"
              onClick={() => onAdminSettings({ name: name.trim(), mode })}
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
