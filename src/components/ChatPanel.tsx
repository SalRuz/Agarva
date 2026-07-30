import { useState, useRef, useEffect, useCallback } from 'react';
import { CHAT_HISTORY_MAX, CHAT_MAX_LENGTH } from '../../shared/constants';
import { HudPanel } from './HudPanel';

export interface ChatLine {
  name: string;
  text: string;
  t: number;
  color?: string;
}

interface ChatPanelProps {
  messages: ChatLine[];
  visible: boolean;
  inputOpen: boolean;
  onCloseInput: () => void;
  onSend: (text: string) => void;
  onInputFocusChange?: (focused: boolean) => void;
}

export function ChatPanel({
  messages,
  visible,
  inputOpen,
  onCloseInput,
  onSend,
  onInputFocusChange,
}: ChatPanelProps) {
  const [draft, setDraft] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const stickBottomRef = useRef(true);

  useEffect(() => {
    if (!inputOpen) {
      setDraft('');
      onInputFocusChange?.(false);
      return;
    }
    const id = requestAnimationFrame(() => {
      inputRef.current?.focus();
      onInputFocusChange?.(true);
    });
    return () => cancelAnimationFrame(id);
  }, [inputOpen, onInputFocusChange]);

  useEffect(() => {
    const el = listRef.current;
    if (!el || !stickBottomRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, visible]);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    const el = listRef.current;
    if (!el) return;
    e.stopPropagation();
    el.scrollTop += e.deltaY;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
    stickBottomRef.current = atBottom;
  }, []);

  const submit = (e?: React.FormEvent) => {
    e?.preventDefault();
    const text = draft.trim().slice(0, CHAT_MAX_LENGTH);
    if (text) onSend(text);
    setDraft('');
    onCloseInput();
  };

  if (!visible) return null;

  const shown = messages.slice(-CHAT_HISTORY_MAX);

  return (
    <div
      className="absolute bottom-4 left-4 z-40 w-[min(360px,calc(100vw-2rem))] pointer-events-auto"
      onWheel={handleWheel}
    >
      <HudPanel id="chat" title="Чат" className="bg-black/55 backdrop-blur-sm rounded-lg px-3 py-2">
        <div
          ref={listRef}
          className="max-h-40 overflow-y-auto space-y-1 text-sm scrollbar-thin select-none"
          style={{ userSelect: 'none' }}
        >
          {shown.length === 0 && (
            <div className="text-gray-500 text-xs">Enter — открыть чат</div>
          )}
          {shown.map((m, i) => (
            <div key={`${m.t}-${i}`} className="text-gray-200 leading-snug break-words">
              <span className="font-semibold" style={{ color: m.color || '#34d399' }}>
                {m.name}
              </span>
              <span className="text-gray-500">: </span>
              <span>{m.text}</span>
            </div>
          ))}
        </div>

        {inputOpen && (
          <form onSubmit={submit} className="mt-2">
            <input
              ref={inputRef}
              type="text"
              value={draft}
              maxLength={CHAT_MAX_LENGTH}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.code === 'Escape') {
                  e.preventDefault();
                  setDraft('');
                  onCloseInput();
                }
              }}
              placeholder="Сообщение…"
              className="w-full px-3 py-2 rounded-lg bg-black/70 border border-white/20 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-sky-500 text-sm"
              style={{ userSelect: 'text', WebkitUserSelect: 'text' }}
            />
          </form>
        )}
      </HudPanel>
    </div>
  );
}
