'use client';

import { useState, useRef, useEffect } from 'react';
import type { WindowInfo, ConversationInfo, ConversationProjectGroup } from '@/lib/types';
import type { CdpStatus, RecentProject } from '@/hooks/use-conversations';
import ConversationSelector from './conversation-selector';

type NewChatTarget = {
  name?: string;
  path?: string;
  projectName?: string;
  projectPath?: string;
};

interface HeaderProps {
  statusState: string;
  statusText: string;
  windows: WindowInfo[];
  conversations: ConversationInfo[];
  conversationProjects: ConversationProjectGroup[];
  activeConversation: ConversationInfo | null;
  isMonitorConnected: boolean;
  cdpStatus: CdpStatus;
  recentProjects: RecentProject[];
  onSelectWindow: (idx: number) => void;
  onSelectConversation: (conversation: ConversationInfo) => void;
  onNewChat: (project?: NewChatTarget) => void | Promise<void>;
  onStartCdp: (projectDir?: string, killExisting?: boolean) => Promise<any>;
  onOpenWindow: (projectDir: string) => Promise<any>;
  onCloseWindow: (index: number, targetId?: string) => Promise<any>;
}

export default function Header({
  statusState, statusText, windows, conversations, conversationProjects, activeConversation,
  isMonitorConnected, cdpStatus, recentProjects, onSelectWindow, onSelectConversation, onNewChat,
  onStartCdp, onOpenWindow, onCloseWindow,
}: HeaderProps) {
  const [windowOpen, setWindowOpen] = useState(false);
  const [newDirPath, setNewDirPath] = useState('');
  const [isOpening, setIsOpening] = useState(false);
  const [isStartingCdp, setIsStartingCdp] = useState(false);
  const [actionMessage, setActionMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setWindowOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Clear action message after 4 seconds
  useEffect(() => {
    if (actionMessage) {
      const t = setTimeout(() => setActionMessage(null), 4000);
      return () => clearTimeout(t);
    }
  }, [actionMessage]);

  const handleStartCdp = async () => {
    // Use the most recent project directory, fall back to '.'
    const projectDir = recentProjects.length > 0 ? recentProjects[0].path : '.';

    setIsStartingCdp(true);
    setActionMessage(null);
    try {
      // killExisting=true to handle the Electron single-instance issue:
      // existing non-CDP windows prevent the CDP server from starting
      const result = await onStartCdp(projectDir, true);
      setActionMessage({
        text: result.message || (result.success ? 'CDP started!' : 'Failed to start CDP'),
        type: result.success ? 'success' : 'error',
      });
    } catch {
      setActionMessage({ text: 'Failed to start CDP server', type: 'error' });
    } finally {
      setIsStartingCdp(false);
    }
  };

  const handleOpenWindow = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newDirPath.trim();
    if (!trimmed || isOpening) return;

    setIsOpening(true);
    setActionMessage(null);
    try {
      const result = await onOpenWindow(trimmed);
      setActionMessage({
        text: result.message || (result.success ? 'Window opened!' : 'Failed to open'),
        type: result.success ? 'success' : 'error',
      });
      if (result.success) setNewDirPath('');
    } catch {
      setActionMessage({ text: 'Failed to open window', type: 'error' });
    } finally {
      setIsOpening(false);
    }
  };

  const handleCloseWindow = async (idx: number, targetId: string | undefined, e: React.MouseEvent) => {
    e.stopPropagation();
    const confirmed = window.confirm(`Close window "${windows[idx]?.title || idx}"?`);
    if (!confirmed) return;

    const result = await onCloseWindow(idx, targetId);
    setActionMessage({
      text: result.message || (result.success ? 'Closed!' : 'Failed to close'),
      type: result.success ? 'success' : 'error',
    });
  };

  return (
    <header className="header">
      <div className="header-left">
        <div className="logo">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="url(#hg)" strokeWidth="1.5">
            <defs>
              <linearGradient id="hg" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#6366f1" />
                <stop offset="100%" stopColor="#a855f7" />
              </linearGradient>
            </defs>
            <circle cx="12" cy="12" r="10" />
            <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
            <line x1="2" y1="12" x2="22" y2="12" />
          </svg>
        </div>
        <div className="header-brand">
          <div className="header-title"><h1>Antigravity</h1></div>
          <div className={`header-subtitle status-${statusState}`}>
            <span>{statusText}</span>
            <span className={`header-sync-pill ${isMonitorConnected ? 'live' : 'reconnecting'}`}>
              {isMonitorConnected ? 'Live sync' : 'Syncing'}
            </span>
          </div>
        </div>
      </div>
      <div className="header-right">
        {/* Conversation Selector */}
        <ConversationSelector
          conversations={conversations}
          projects={conversationProjects}
          activeConversation={activeConversation}
          onSelect={onSelectConversation}
          onNewChat={onNewChat}
        />

        {/* Window Selector */}
        <div ref={wrapperRef} className={`window-selector-wrapper ${windowOpen ? 'open' : ''}`}>
          <button className="window-selector-btn" onClick={() => setWindowOpen(!windowOpen)} title="Manage Antigravity windows">
            {/* CDP status indicator */}
            <span className={`cdp-indicator ${cdpStatus.active ? 'active' : 'inactive'}`} />
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
              <line x1="8" y1="21" x2="16" y2="21" />
              <line x1="12" y1="17" x2="12" y2="21" />
            </svg>
            <span className="window-selector-label">
              {windows.find(w => w.active)?.title || 'Windows'}
            </span>
            <svg className="chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
          <div className={`window-dropdown ${windowOpen ? 'open' : ''}`}>
            {/* CDP Status Bar */}
            <div className="wm-cdp-status">
              <div className="wm-cdp-info">
                <span className={`wm-cdp-dot ${cdpStatus.active ? 'active' : 'inactive'}`} />
                <span>{cdpStatus.active ? `CDP Active - ${cdpStatus.windowCount} window${cdpStatus.windowCount !== 1 ? 's' : ''}` : 'CDP Inactive'}</span>
              </div>
              {!cdpStatus.active && (
                <button
                  className="wm-cdp-start-btn"
                  onClick={handleStartCdp}
                  disabled={isStartingCdp}
                  title="Start Antigravity with CDP"
                >
                  {isStartingCdp ? (
                    <span className="wm-spinner" />
                  ) : (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <polygon points="5 3 19 12 5 21 5 3" />
                    </svg>
                  )}
                  {isStartingCdp ? 'Starting...' : 'Start CDP'}
                </button>
              )}
            </div>

            {/* Window List */}
            <div className="window-dropdown-header">
              Open Windows
            </div>
            {windows.map(w => (
              <div key={w.index} className={`window-item ${w.active ? 'active' : ''}`}>
                <button
                  className="window-item-select"
                  onClick={() => { onSelectWindow(w.index); setWindowOpen(false); }}
                >
                  <span className="window-dot" />
                  <span className="window-item-title">{w.title}</span>
                </button>
                <button
                  className="window-item-close"
                  onClick={(e) => handleCloseWindow(w.index, w.targetId, e)}
                  title={`Close "${w.title}"`}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
            ))}
            {windows.length === 0 && (
              <div style={{ padding: '12px', color: 'var(--text-muted)', fontSize: '12px' }}>
                No windows detected
              </div>
            )}
            {/* Recent Projects */}
            {recentProjects.length > 0 && (
              <div className="wm-recent-section">
                <div className="wm-recent-header">Recent Projects</div>
                {recentProjects.map(p => (
                  <button
                    key={p.path}
                    className="wm-recent-item"
                    onClick={async () => {
                      setIsOpening(true);
                      setActionMessage(null);
                      try {
                        const result = await onOpenWindow(p.path);
                        setActionMessage({
                          text: result.message || (result.success ? 'Opened!' : 'Failed'),
                          type: result.success ? 'success' : 'error',
                        });
                      } catch {
                        setActionMessage({ text: 'Failed to open', type: 'error' });
                      } finally {
                        setIsOpening(false);
                      }
                    }}
                    disabled={isOpening}
                    title={p.path}
                  >
                    <svg className="wm-recent-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                    </svg>
                    <div className="wm-recent-info">
                      <span className="wm-recent-name">{p.name}</span>
                      <span className="wm-recent-path">{p.path}</span>
                    </div>
                  </button>
                ))}
              </div>
            )}

            {/* Open New Window */}
            <div className="wm-open-section">
              <div className="wm-open-label">Open New Window</div>
              <form className="wm-open-form" onSubmit={handleOpenWindow}>
                <input
                  ref={inputRef}
                  type="text"
                  className="wm-open-input"
                  value={newDirPath}
                  onChange={(e) => setNewDirPath(e.target.value)}
                  placeholder="/path/to/project"
                  disabled={isOpening}
                />
                <button
                  type="submit"
                  className="wm-open-btn"
                  disabled={isOpening || !newDirPath.trim()}
                  title="Open directory in Antigravity"
                >
                  {isOpening ? (
                    <span className="wm-spinner" />
                  ) : (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <line x1="12" y1="5" x2="12" y2="19" />
                      <line x1="5" y1="12" x2="19" y2="12" />
                    </svg>
                  )}
                </button>
              </form>
            </div>

            {/* Action Message Toast */}
            {actionMessage && (
              <div className={`wm-action-message ${actionMessage.type}`}>
                {actionMessage.text}
              </div>
            )}
          </div>
        </div>

        {/* New Chat Button */}
        <button className="icon-btn header-new-chat-btn" onClick={() => onNewChat()} title="New Chat" aria-label="New Chat">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>
      </div>
    </header>
  );
}
