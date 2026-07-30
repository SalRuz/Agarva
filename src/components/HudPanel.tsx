import type { ReactNode } from 'react';
import { useState, useEffect } from 'react';

interface HudPanelProps {
  title: string;
  className?: string;
  children: ReactNode;
  /** When collapsed, only the title bar with ○ is shown */
  collapsedContent?: ReactNode;
  /** Stable id for localStorage persistence (preferred) */
  id?: string;
  /** Explicit storage key; overrides id-based key */
  storageKey?: string;
}

function resolveStorageKey(id?: string, storageKey?: string): string | null {
  if (storageKey) return storageKey;
  if (id) return `agarHudCollapsed:${id}`;
  return null;
}

/**
 * Gameplay HUD chrome: non-selectable text, × collapses, ○ expands.
 * Collapsed state persists in localStorage when id/storageKey is set.
 */
export function HudPanel({
  title,
  className = '',
  children,
  collapsedContent,
  id,
  storageKey,
}: HudPanelProps) {
  const key = resolveStorageKey(id, storageKey);
  const [collapsed, setCollapsed] = useState(() => {
    if (!key) return false;
    try {
      return localStorage.getItem(key) === '1';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    if (!key) return;
    try {
      localStorage.setItem(key, collapsed ? '1' : '0');
    } catch {
      // ignore
    }
  }, [collapsed, key]);

  return (
    <div
      className={`select-none ${className}`}
      style={{ userSelect: 'none', WebkitUserSelect: 'none' }}
    >
      <div className="flex items-center justify-between gap-2 mb-1">
        <div className="text-white/80 text-xs font-semibold truncate">{title}</div>
        <div className="flex items-center gap-0.5 shrink-0">
          <button
            type="button"
            title="Свернуть"
            disabled={collapsed}
            onClick={(e) => {
              e.stopPropagation();
              setCollapsed(true);
            }}
            className="w-5 h-5 leading-none rounded text-sm text-white/80 hover:bg-white/15 disabled:opacity-30 disabled:hover:bg-transparent"
          >
            ×
          </button>
          <button
            type="button"
            title="Развернуть"
            disabled={!collapsed}
            onClick={(e) => {
              e.stopPropagation();
              setCollapsed(false);
            }}
            className="w-5 h-5 leading-none rounded text-sm text-white/80 hover:bg-white/15 disabled:opacity-30 disabled:hover:bg-transparent"
          >
            ○
          </button>
        </div>
      </div>
      {collapsed ? collapsedContent ?? null : children}
    </div>
  );
}
