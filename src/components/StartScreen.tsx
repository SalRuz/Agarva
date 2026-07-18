import { useState } from 'react';

interface StartScreenProps {
  onStart: (name: string) => void;
}

export function StartScreen({ onStart }: StartScreenProps) {
  const [name, setName] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (name.trim()) {
      onStart(name.trim());
    }
  };

  return (
    <div className="absolute inset-0 flex items-center justify-center p-4 pointer-events-none">
      <div className="bg-black/70 backdrop-blur-lg rounded-2xl p-8 max-w-md w-full border border-white/20 pointer-events-auto">
        <div className="text-center mb-8">
          <h1 className="text-6xl font-bold text-white mb-2 tracking-wider">
            <span className="text-red-500">А</span>
            <span className="text-yellow-500">Г</span>
            <span className="text-green-500">А</span>
            <span className="text-blue-500">Р</span>
            <span className="text-purple-500">В</span>
            <span className="text-pink-500">А</span>
          </h1>
          <p className="text-gray-400 text-lg">Симулятор с AI ботами</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Введите ваш никнейм"
            maxLength={15}
            className="w-full px-4 py-3 rounded-lg bg-white/10 border border-white/20 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
          />
          <button
            type="submit"
            disabled={!name.trim()}
            className="w-full py-3 rounded-lg bg-gradient-to-r from-green-500 to-emerald-600 text-white font-bold text-lg hover:from-green-600 hover:to-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all transform hover:scale-[1.02]"
          >
            ▶ Играть
          </button>
        </form>

        <div className="mt-6 text-center text-gray-500 text-sm space-y-1">
          <p>🖱 Мышь — управление</p>
          <p>⎵ Пробел — разделиться</p>
          <p>Ⓦ W — выстрелить массой</p>
          <p>Ⓠ Q — +100 массы (админ)</p>
          <p>⎋ ESC — пауза / смена ника</p>
          <p>🎯 Колёсико — зум</p>
        </div>
      </div>
    </div>
  );
}