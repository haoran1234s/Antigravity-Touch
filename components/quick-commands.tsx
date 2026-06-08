'use client';

import { useEffect, useRef, useState } from 'react';

export interface QuickCommand {
  id: string;
  label: string;
  text: string;
}

const STORAGE_KEY = 'at_quick_commands';

const DEFAULT_COMMANDS: QuickCommand[] = [
  { id: 'continue', label: 'Continue', text: 'Continue.' },
  { id: 'explain', label: 'Explain', text: 'Explain what you just did and why.' },
  { id: 'tests', label: 'Add tests', text: 'Add tests for the code you just changed.' },
  { id: 'fix-build', label: 'Fix build', text: 'Run the build and fix any errors.' },
  { id: 'summarize', label: 'Summarize', text: 'Summarize the current changes so far.' },
];

function loadCommands(): QuickCommand[] {
  if (typeof window === 'undefined') return DEFAULT_COMMANDS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_COMMANDS;
    const parsed = JSON.parse(raw) as QuickCommand[];
    if (Array.isArray(parsed)) return parsed;
  } catch {
    // ignore malformed storage
  }
  return DEFAULT_COMMANDS;
}

interface QuickCommandsProps {
  /** Insert the chosen command text into the chat input. */
  onInsert: (text: string) => void;
}

/**
 * Saved prompt snippets that can be inserted into the chat input with one tap.
 * Persisted in localStorage so they survive reloads. Mobile-friendly: a single
 * toolbar button opens a compact list.
 */
export default function QuickCommands({ onInsert }: QuickCommandsProps) {
  const [open, setOpen] = useState(false);
  const [commands, setCommands] = useState<QuickCommand[]>(DEFAULT_COMMANDS);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Load persisted commands after mount; localStorage is unavailable during SSR.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCommands(loadCommands());
  }, []);

  const persist = (next: QuickCommand[]) => {
    setCommands(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // storage may be unavailable (private mode); keep in-memory state
    }
  };

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleSelect = (cmd: QuickCommand) => {
    onInsert(cmd.text);
    setOpen(false);
  };

  const handleAdd = () => {
    const text = window.prompt('New quick command text:');
    if (!text || !text.trim()) return;
    const label = window.prompt('Short label:', text.trim().slice(0, 20)) || text.trim().slice(0, 20);
    persist([
      ...commands,
      { id: `c${Date.now()}`, label: label.trim(), text: text.trim() },
    ]);
  };

  const handleDelete = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    persist(commands.filter((c) => c.id !== id));
  };

  return (
    <div ref={wrapperRef} className="quick-commands-wrapper">
      <button
        className={`quick-commands-btn ${open ? 'active' : ''}`}
        onClick={() => setOpen((o) => !o)}
        title="Quick commands"
        aria-label="Quick commands"
        type="button"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polyline points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
        </svg>
      </button>

      <div className={`quick-commands-dropdown ${open ? 'open' : ''}`}>
        <div className="quick-commands-header">
          <span>Quick Commands</span>
          <button className="quick-commands-add" onClick={handleAdd} type="button" title="Add command">+</button>
        </div>
        {commands.length === 0 ? (
          <div className="quick-commands-empty">No commands. Tap + to add one.</div>
        ) : (
          <div className="quick-commands-list">
            {commands.map((cmd) => (
              <button
                key={cmd.id}
                className="quick-command-item"
                onClick={() => handleSelect(cmd)}
                type="button"
                title={cmd.text}
              >
                <span className="quick-command-label">{cmd.label}</span>
                <span
                  className="quick-command-delete"
                  onClick={(e) => handleDelete(cmd.id, e)}
                  role="button"
                  tabIndex={-1}
                  aria-label={`Delete ${cmd.label}`}
                >
                  ×
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
