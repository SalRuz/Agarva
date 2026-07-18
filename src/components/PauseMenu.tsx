import { useState, useEffect } from 'react';

interface PauseMenuProps {
  currentName: string;
  onUpdateName: (newName: string) => void;
  onResume: () => void;
  onBackToMenu: () => void;
}

export function PauseMenu({ currentName, onUpdateName, onResume, onBackToMenu }: PauseMenuProps) {
  const [name, setName] = useState(currentName);

  useEffect(() => {
    setName(currentName);
  }, [currentName]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (name.trim()) {
      onUpdateName(name.trim());
    }
    onResume();
  };

  return (
    <div className="absolute inset-0 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm pointer-events-auto z-50">
      <div className="bg-black/80 backdrop-blur-lg rounded-2xl p-8 max-w-md w-full border border-white/20">
        <div className="text-center mb-6">
          <h2 className="text-4xl font-bold text-white mb-2">⏸ Пауза</h2>
          <p className="text-gray-400 text-sm">Игра продолжается в фоне</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-gray-400 text-sm mb-2 block">Ваш никнейм:</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Введите новый ник"
              maxLength={15}
              autoFocus
              className="w-full px-4 py-3 rounded-lg bg-white/10 border border-white/20 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
            />
          </div>
          
          <button
            type="submit"
            className="w-full py-3 rounded-lg bg-gradient-to-r from-green-500 to-emerald-600 text-white font-bold text-lg hover:from-green-600 hover:to-emerald-700 transition-all transform hover:scale-[1.02]"
          >
            ▶ Продолжить
          </button>
        </form>

        <div className="my-4 flex items-center gap-4">
          <div className="flex-1 h-px bg-white/20" />
          <span className="text-gray-500 text-sm">или</span>
          <div className="flex-1 h-px bg-white/20" />
        </div>

        <button
          onClick={onBackToMenu}
          className="w-full py-3 rounded-lg bg-white/10 border border-white/20 text-white font-medium hover:bg-white/20 transition-all"
        >
          ← В главное меню
        </button>

        <div className="mt-6 text-center text-gray-500 text-xs">
          Нажмите ESC чтобы продолжить
        </div>
      </div>
    </div>
  );
}