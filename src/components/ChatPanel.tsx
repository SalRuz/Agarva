import { useState, useRef, useEffect, useCallback } from 'react';
import { CHAT_HISTORY_MAX, CHAT_MAX_LENGTH } from '../../shared/constants';
import { HudPanel } from './HudPanel';

function levelBadgeClass(level: number): string {
  if (level >= 201) return 'bg-sky-500 text-white';
  if (level >= 151) return 'bg-red-500 text-white';
  if (level >= 101) return 'bg-orange-500 text-white';
  if (level >= 51) return 'bg-yellow-400 text-black';
  return 'bg-emerald-500 text-white';
}

export interface ChatLine {
  name: string;
  text: string;
  t: number;
  color?: string;
  fromTg?: boolean;
  level?: number;
  hideLevel?: boolean;
}

interface ChatPanelProps {
  messages: ChatLine[];
  privateChats?: Record<string, ChatLine[]>;
  visible: boolean;
  inputOpen: boolean;
  onCloseInput: () => void;
  onSend: (text: string) => void;
  onSendPrivate?: (name: string, text: string) => void;
  onInputFocusChange?: (focused: boolean) => void;
  /** Click nick → mention in chat */
  onClickNick?: (name: string) => void;
  onPrivateMessage?: (name: string) => void;
  /** Prefill draft when clicking a nick (e.g. "Name: ") */
  mentionPrefix?: string | null;
  onMentionConsumed?: () => void;
  openPrivateWith?: string | null;
  onPrivateOpened?: () => void;
  ownName?: string;
  mobileLayout?: { x: number; y: number; size: number };
}

export function ChatPanel({
  messages,
  privateChats = {},
  visible,
  inputOpen,
  onCloseInput,
  onSend,
  onSendPrivate,
  onInputFocusChange,
  onClickNick,
  onPrivateMessage,
  mentionPrefix,
  onMentionConsumed,
  openPrivateWith,
  onPrivateOpened,
  ownName = '',
  mobileLayout,
}: ChatPanelProps) {
  const [draft, setDraft] = useState('');
  const [activeTab, setActiveTab] = useState<string>('general');
  const [contextMenu, setContextMenu] = useState<{ name: string; x: number; y: number } | null>(null);
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
    if (!mentionPrefix) return;
    setDraft(mentionPrefix);
    onMentionConsumed?.();
    const id = requestAnimationFrame(() => {
      inputRef.current?.focus();
      const el = inputRef.current;
      if (el) {
        const len = el.value.length;
        el.setSelectionRange(len, len);
      }
    });
    return () => cancelAnimationFrame(id);
  }, [mentionPrefix, onMentionConsumed]);

  useEffect(() => {
    if (!openPrivateWith) return;
    setActiveTab(openPrivateWith);
    onPrivateOpened?.();
  }, [openPrivateWith, onPrivateOpened]);

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
    if (text) {
      if (activeTab === 'general') onSend(text);
      else onSendPrivate?.(activeTab, text);
    }
    setDraft('');
    onCloseInput();
  };

  if (!visible) return null;

  const shown = (activeTab === 'general' ? messages : privateChats[activeTab] ?? []).slice(-CHAT_HISTORY_MAX);
  const tabNames = Object.keys(privateChats);
  const isOwnName = (name: string) => name.trim().toLocaleLowerCase() === ownName.trim().toLocaleLowerCase();

  return (
    <div
      className="absolute z-40 w-[min(360px,calc(100vw-2rem))] pointer-events-auto"
      style={mobileLayout ? { left: `${mobileLayout.x}%`, top: `${mobileLayout.y}%`, transform: 'translate(-100%, -50%)' } : { bottom: '1rem', left: '1rem' }}
      onWheel={handleWheel}
      onClick={() => setContextMenu(null)}
    >
      <HudPanel id="chat" title="Чат" className="bg-black/55 backdrop-blur-sm rounded-lg px-3 py-2">
        <div className="mb-2 flex max-w-full gap-1 overflow-x-auto text-xs">
          <button type="button" onClick={() => setActiveTab('general')} className={`shrink-0 rounded px-2 py-1 ${activeTab === 'general' ? 'bg-sky-600 text-white' : 'bg-white/10 text-gray-300'}`}>Общий чат</button>
          {tabNames.map((name) => <button key={name} type="button" onClick={() => setActiveTab(name)} className={`shrink-0 rounded px-2 py-1 ${activeTab === name ? 'bg-sky-600 text-white' : 'bg-white/10 text-gray-300'}`}>{name}</button>)}
        </div>
        <div
          ref={listRef}
          className="max-h-40 overflow-y-auto space-y-1 text-sm scrollbar-thin select-none"
          style={{ userSelect: 'none' }}
        >
          {shown.length === 0 && (
            <div className="text-gray-500 text-xs">Enter или кнопка ЧАТ — открыть чат</div>
          )}
          {shown.map((m, i) => (
            <div key={`${m.t}-${i}`} className="text-gray-200 leading-snug break-words">
              <button
                type="button"
                className="font-semibold hover:underline cursor-pointer bg-transparent border-0 p-0"
                style={{ color: m.color || '#34d399' }}
                onClick={() => onClickNick?.(m.name)}
                onContextMenu={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  if (isOwnName(m.name) || isSystemName(m.name)) return;
                  setContextMenu({ name: m.name, x: event.clientX, y: event.clientY });
                }}
                title={isOwnName(m.name) || isSystemName(m.name) ? 'Системному сообщению нельзя написать' : 'ЛКМ — упомянуть; ПКМ — написать личное сообщение'}
              >
                {m.hideLevel ? (
                  <span className="mr-1" aria-label="Уровень скрыт">👤</span>
                ) : m.level !== undefined ? (
                  <span className={`mr-1 inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full px-1 text-[10px] font-bold leading-none ${levelBadgeClass(m.level)}`}>
                    {m.level}
                  </span>
                ) : null}
                {m.name}
              </button>
              {m.fromTg && <span className="ml-1 font-bold text-sky-400">(TG)</span>}
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
              placeholder={activeTab === 'general' ? 'Сообщение…' : `Сообщение для ${activeTab}…`}
              className="w-full px-3 py-2 rounded-lg bg-black/70 border border-white/20 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-sky-500 text-sm"
              style={{ userSelect: 'text', WebkitUserSelect: 'text' }}
            />
          </form>
        )}
      </HudPanel>
      {contextMenu && (
        <button
          type="button"
          className="fixed z-[70] rounded bg-slate-900 px-3 py-2 text-sm text-white shadow-xl ring-1 ring-white/20 hover:bg-slate-800"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(event) => {
            event.stopPropagation();
            onPrivateMessage?.(contextMenu.name);
            setContextMenu(null);
          }}
        >
          Написать личное сообщение
        </button>
      )}
    </div>
  );
}

function isSystemName(name: string): boolean {
  return /^(?:🏆\s*)?система$/iu.test(name.trim());
}
