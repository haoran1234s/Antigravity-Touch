'use client';

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import type { ConversationInfo, ConversationProjectGroup } from '@/lib/types';

const COLLAPSED_STORAGE_KEY = 'at_collapsed_projects';
const PINNED_STORAGE_KEY = 'at_pinned_conversations';

/** Stable identity for pinning — prefers a real id, falls back to index+title. */
function pinKey(conversation: ConversationInfo) {
  return conversation.id && !/^-?\d+$/.test(conversation.id)
    ? `id:${conversation.id}`
    : `idx:${conversation.index}:${conversation.title || ''}`;
}

interface ConversationSelectorProps {
  conversations: ConversationInfo[];
  projects?: ConversationProjectGroup[];
  activeConversation: ConversationInfo | null;
  isLoading?: boolean;
  syncError?: string | null;
  onSelect: (conversation: ConversationInfo) => void;
  onLoadConversations?: () => void | Promise<unknown>;
  onNewChat?: (project?: { name: string; path?: string }) => void | Promise<void>;
}

type ProjectView = {
  id: string;
  name: string;
  path?: string;
  active: boolean;
  conversationCount: number;
  conversations: ConversationInfo[];
};

function formatRelativeTime(dateStr?: string) {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  const diff = Date.now() - date.getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr${hours !== 1 ? 's' : ''} ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} day${days !== 1 ? 's' : ''} ago`;
  const weeks = Math.floor(days / 7);
  return `${weeks} wk${weeks !== 1 ? 's' : ''} ago`;
}

function getConversationKey(conversation: ConversationInfo, fallbackIndex: number) {
  return `${conversation.id || 'conv'}-${conversation.index}-${conversation.title || 'untitled'}-${fallbackIndex}`;
}

function getDisplayTitle(conversation: ConversationInfo) {
  if (conversation.title) return conversation.title;
  if (conversation.id) return `${conversation.id.substring(0, 20)}...`;
  return 'Untitled conversation';
}

function isSameConversation(a: ConversationInfo | null, b: ConversationInfo) {
  if (!a) return false;
  if (a.id && b.id && a.id === b.id) return true;
  return a.index === b.index && a.title === b.title;
}

function getConversationMeta(conversation: ConversationInfo) {
  const fileText = conversation.files?.length
    ? ` - ${conversation.files.length} artifact${conversation.files.length !== 1 ? 's' : ''}`
    : '';
  if (conversation.source === 'brain') return `Project history${fileText}`;
  if (conversation.index === -1) return `Open in IDE${fileText}`;
  return `Conversation #${conversation.index + 1}${fileText}`;
}

function normalize(value?: string | null) {
  return (value || '').toLowerCase().trim();
}

function matchesConversation(conversation: ConversationInfo, query: string) {
  const haystack = [
    getDisplayTitle(conversation),
    conversation.id,
    conversation.summary,
    conversation.projectName,
    conversation.projectPath,
    ...(conversation.workspacePaths || []),
  ].map(normalize).filter(Boolean);
  return haystack.some(value => value.includes(query));
}

function projectNameForConversation(conversation: ConversationInfo) {
  return conversation.projectName || conversation.workspacePaths?.[0] || 'Current project';
}

function sortConversations(items: ConversationInfo[]) {
  return [...items].sort((a, b) => {
    if (a.active !== b.active) return a.active ? -1 : 1;
    if (!a.mtime && !b.mtime) return a.index - b.index;
    if (!a.mtime) return 1;
    if (!b.mtime) return -1;
    return new Date(b.mtime).getTime() - new Date(a.mtime).getTime();
  });
}

function dedupeConversations(items: ConversationInfo[]) {
  const seen = new Set<string>();
  const deduped: ConversationInfo[] = [];
  for (const conversation of items) {
    const key = conversation.id && !/^-?\d+$/.test(conversation.id)
      ? `id:${conversation.id}`
      : `idx:${conversation.index}:${conversation.title}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(conversation);
  }
  return sortConversations(deduped);
}

function buildFallbackProjects(conversations: ConversationInfo[], current: ConversationInfo | null): ProjectView[] {
  const groups = new Map<string, ProjectView>();
  const ensure = (name: string, path?: string, active = false) => {
    const id = path || name;
    const existing = groups.get(id);
    if (existing) {
      existing.active = existing.active || active;
      return existing;
    }
    const group: ProjectView = { id, name, path, active, conversationCount: 0, conversations: [] };
    groups.set(id, group);
    return group;
  };

  for (const conversation of conversations) {
    const isCurrent = isSameConversation(current, conversation) || conversation.active;
    const group = ensure(
      projectNameForConversation(conversation),
      conversation.projectPath,
      isCurrent,
    );
    group.conversations.push(conversation);
  }

  return Array.from(groups.values()).map(group => {
    const groupedConversations = dedupeConversations(group.conversations);
    return { ...group, conversationCount: groupedConversations.length, conversations: groupedConversations };
  });
}

export default function ConversationSelector({
  conversations,
  projects = [],
  activeConversation,
  isLoading = false,
  syncError = null,
  onSelect,
  onLoadConversations,
  onNewChat,
}: ConversationSelectorProps) {
  const [open, setOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [query, setQuery] = useState('');
  const [isMobileLayout, setIsMobileLayout] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [pinned, setPinned] = useState<Set<string>>(new Set());
  const wrapperRef = useRef<HTMLDivElement>(null);
  const lastOpenSyncAtRef = useRef(0);

  // Persist pinned conversations so favorites float to the top of each project.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(PINNED_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as string[];
        // eslint-disable-next-line react-hooks/set-state-in-effect
        if (Array.isArray(parsed)) setPinned(new Set(parsed));
      }
    } catch {
      // ignore malformed/unavailable storage
    }
  }, []);

  const togglePin = (conversation: ConversationInfo) => {
    const key = pinKey(conversation);
    setPinned((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      try {
        window.localStorage.setItem(PINNED_STORAGE_KEY, JSON.stringify(Array.from(next)));
      } catch {
        // storage may be unavailable (private mode)
      }
      return next;
    });
  };

  // Persist which project groups are collapsed so the layout is remembered.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(COLLAPSED_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as string[];
        // eslint-disable-next-line react-hooks/set-state-in-effect
        if (Array.isArray(parsed)) setCollapsed(new Set(parsed));
      }
    } catch {
      // ignore malformed/unavailable storage
    }
  }, []);

  const persistCollapsed = (next: Set<string>) => {
    try {
      window.localStorage.setItem(COLLAPSED_STORAGE_KEY, JSON.stringify(Array.from(next)));
    } catch {
      // storage may be unavailable (private mode)
    }
  };

  const applyCollapsed = (next: Set<string>) => {
    setCollapsed(next);
    persistCollapsed(next);
  };

  const toggleCollapse = (id: string) => {
    const next = new Set(collapsed);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    applyCollapsed(next);
  };

  const current = activeConversation || conversations.find(c => c.active) || projects.flatMap(p => p.conversations).find(c => c.active) || null;

  const closeDropdown = useCallback(() => {
    setOpen(false);
    setShowAll(false);
    setQuery('');
  }, [setOpen, setShowAll, setQuery]);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(max-width: 767px)');
    const syncLayout = () => setIsMobileLayout(mediaQuery.matches);
    syncLayout();
    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener('change', syncLayout);
      return () => mediaQuery.removeEventListener('change', syncLayout);
    }
    mediaQuery.addListener(syncLayout);
    return () => mediaQuery.removeListener(syncLayout);
  }, []);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        closeDropdown();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [closeDropdown]);

  useEffect(() => {
    if (!open) return;

    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeDropdown();
    };

    document.addEventListener('keydown', handler);
    return () => {
      document.removeEventListener('keydown', handler);
    };
  }, [open, closeDropdown]);

  const groupedProjects = useMemo<ProjectView[]>(() => {
    const sourceProjects = projects.length > 0
      ? projects.map((project) => ({
          ...project,
          conversationCount: project.conversationCount || project.conversations.length,
          conversations: dedupeConversations(project.conversations),
        }))
      : buildFallbackProjects(conversations, current);

    const visibleSourceProjects = sourceProjects.filter(project =>
      projects.length > 0
        ? project.active || !!project.path || project.conversations.length > 0
        : project.active || project.conversations.length > 0
    );
    if (projects.length > 0) return visibleSourceProjects;

    return [...visibleSourceProjects].sort((a, b) => {
      if (a.active !== b.active) return a.active ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }, [conversations, current, projects]);

  const filteredProjects = useMemo<ProjectView[]>(() => {
    const normalized = normalize(query);
    if (!normalized) return groupedProjects;

    return groupedProjects
      .map(project => {
        const projectMatches = [project.name, project.path].map(normalize).some(value => value.includes(normalized));
        const filteredConversations = projectMatches
          ? project.conversations
          : project.conversations.filter(conversation => matchesConversation(conversation, normalized));
        return {
          ...project,
          conversations: filteredConversations,
          conversationCount: filteredConversations.length,
        };
      })
      .filter(project => {
        const projectMatches = [project.name, project.path].map(normalize).some(value => value.includes(normalized));
        return project.conversations.length > 0 || projectMatches;
      });
  }, [groupedProjects, query]);

  const SHOW_LIMIT = 8;
  const shouldShowAll = isMobileLayout || showAll || query.trim().length > 0;
  const visibleProjects = useMemo<ProjectView[]>(() => {
    if (shouldShowAll) return filteredProjects;

    let remaining = SHOW_LIMIT;
    const visible: ProjectView[] = [];
    for (const project of filteredProjects) {
      if (remaining <= 0) break;
      if (project.conversations.length === 0) {
        visible.push({
          ...project,
          conversations: [],
          conversationCount: project.conversationCount,
        });
        continue;
      }
      const visibleConversations = project.conversations.slice(0, remaining);
      if (visibleConversations.length === 0) continue;
      visible.push({
        ...project,
        conversations: visibleConversations,
        conversationCount: project.conversationCount,
      });
      remaining -= visibleConversations.length;
    }
    return visible;
  }, [filteredProjects, shouldShowAll]);

  const totalCount = groupedProjects.reduce((sum, project) => sum + project.conversations.length, 0) || conversations.length;
  const filteredCount = filteredProjects.reduce((sum, project) => sum + project.conversations.length, 0);
  const visibleCount = visibleProjects.reduce((sum, project) => sum + project.conversations.length, 0);
  const hiddenCount = shouldShowAll ? 0 : Math.max(filteredCount - visibleCount, 0);
  const activeProject = groupedProjects.find(project => project.active);
  const hasConversationData = visibleProjects.length > 0 || conversations.length > 0;
  const showSyncLoading = isLoading && !hasConversationData;

  const handleSelect = (conversation: ConversationInfo) => {
    if (conversation.active || isSameConversation(current, conversation)) {
      closeDropdown();
      return;
    }
    onSelect(conversation);
    closeDropdown();
  };

  const handleNewChat = async (project?: ProjectView) => {
    closeDropdown();
    await onNewChat?.(project ? { name: project.name, path: project.path } : undefined);
  };

  // Searching always expands so matches are never hidden behind a collapsed group.
  const searching = query.trim().length > 0;
  const isCollapsed = (project: ProjectView) => !searching && collapsed.has(project.id);
  const isPinned = (conversation: ConversationInfo) => pinned.has(pinKey(conversation));
  // Stable sort keeps the existing active/recency order; pinned items float up.
  const orderConversations = (items: ConversationInfo[]) =>
    [...items].sort((a, b) => (isPinned(a) ? 0 : 1) - (isPinned(b) ? 0 : 1));
  const allCollapsed = visibleProjects.length > 0 && visibleProjects.every((p) => collapsed.has(p.id));

  const toggleAll = () => {
    const next = allCollapsed ? new Set<string>() : new Set(groupedProjects.map((p) => p.id));
    applyCollapsed(next);
  };

  const handleToggleOpen = () => {
    const nextOpen = !open;
    setOpen(nextOpen);
    if (nextOpen && !isLoading) {
      const now = Date.now();
      const shouldRefresh = !hasConversationData || now - lastOpenSyncAtRef.current > 15_000;
      if (!shouldRefresh) return;
      lastOpenSyncAtRef.current = now;
      void Promise.resolve(onLoadConversations?.()).catch(() => undefined);
    }
  };

  return (
    <div ref={wrapperRef} className={`conv-selector-wrapper ${open ? 'open' : ''}`}>
      <button
        className="conv-selector-btn"
        onClick={handleToggleOpen}
        title="Switch project or conversation"
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
        <span className="conv-selector-title">{current?.title?.substring(0, 28) || 'Projects'}</span>
        {totalCount > 1 && <span className="conv-selector-count" aria-label={`${totalCount} conversations`}>{totalCount}</span>}
        {isLoading && <span className="wm-spinner conv-selector-spinner" aria-label="同步 PC 对话中" />}
        <svg className="chevron" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      <div
        className={`conv-mobile-backdrop ${open ? 'open' : ''}`}
        style={open ? { opacity: 1, pointerEvents: 'auto' } : { opacity: 0, pointerEvents: 'none' }}
        onClick={closeDropdown}
        aria-hidden="true"
      />

      <div
        className={`conv-dropdown ${open ? 'open' : ''}`}
        style={open ? { opacity: 1, transform: 'translateY(0) scale(1)', pointerEvents: 'auto' } : undefined}
        role="dialog"
        aria-modal={isMobileLayout ? true : undefined}
        aria-label="Project and conversation manager"
      >
        <div className="conv-dropdown-header">
          <div className="conv-dropdown-title-group">
            <div className="conv-dropdown-title-row">
              <span className="conv-dropdown-title">Projects</span>
              {totalCount > 0 && <span className="conv-dropdown-count">{totalCount}</span>}
              {visibleProjects.length > 1 && !searching && (
                <button
                  className="conv-toggle-all"
                  onClick={(e) => { e.stopPropagation(); toggleAll(); }}
                  title={allCollapsed ? 'Expand all projects' : 'Collapse all projects'}
                  aria-label={allCollapsed ? 'Expand all projects' : 'Collapse all projects'}
                  type="button"
                >
                  {allCollapsed ? 'Expand all' : 'Collapse all'}
                </button>
              )}
            </div>
            <span className="conv-dropdown-subtitle">Browse projects and open saved conversations without starting a new chat</span>
          </div>
          <button className="conv-mobile-close" onClick={closeDropdown} aria-label="Close project manager">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="conv-mobile-tools">
          <label className="conv-search" htmlFor="conversation-search">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              id="conversation-search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search projects or conversations"
              autoComplete="off"
            />
          </label>
          {onNewChat && (
            <button
              className="conv-new-chat-btn"
              onClick={() => handleNewChat(activeProject)}
              title={activeProject ? `New chat in ${activeProject.name}` : 'New chat'}
              aria-label={activeProject ? `New chat in ${activeProject.name}` : 'New chat'}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              {activeProject ? 'New in current' : 'New chat'}
            </button>
          )}
        </div>

        {showSyncLoading && (
          <div className="conv-sync-loading" role="status" aria-live="polite">
            <span className="wm-spinner" />
            <div>
              <span className="conv-sync-title">正在同步 PC 端对话</span>
              <span className="conv-sync-subtitle">按 PC 左侧项目分组加载，请稍候…</span>
            </div>
          </div>
        )}

        {!showSyncLoading && syncError && (
          <div className="conv-sync-warning" role="status" aria-live="polite">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            <span>{syncError}</span>
          </div>
        )}

        <div className="conv-dropdown-list">
          {visibleProjects.map((project) => {
            const collapsedNow = isCollapsed(project);
            return (
            <div key={project.id} className={`conv-project-section ${project.active ? 'active' : ''} ${collapsedNow ? 'collapsed' : ''}`}>
              <div className="conv-project-header">
                <div
                  className="conv-project-title-line"
                  role="button"
                  tabIndex={0}
                  aria-expanded={!collapsedNow}
                  onClick={() => toggleCollapse(project.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      toggleCollapse(project.id);
                    }
                  }}
                  title={collapsedNow ? `Expand ${project.name}` : `Collapse ${project.name}`}
                >
                  <svg className={`conv-project-chevron ${collapsedNow ? 'collapsed' : ''}`} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                  <svg className="conv-project-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                  </svg>
                  <span className="conv-project-name">{project.name}</span>
                  <span className="conv-project-count">{project.conversationCount}</span>
                  {onNewChat && (
                    <button
                      className="conv-project-new-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        void handleNewChat(project);
                      }}
                      title={`New chat in ${project.name}`}
                      aria-label={`New chat in ${project.name}`}
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                        <line x1="12" y1="5" x2="12" y2="19" />
                        <line x1="5" y1="12" x2="19" y2="12" />
                      </svg>
                      <span>New</span>
                    </button>
                  )}
                </div>
                {project.path && <div className="conv-project-path">{project.path}</div>}
              </div>

              {!collapsedNow && (
              <div className="conv-project-conversations">
                {project.conversations.length === 0 && (
                  <div className="conv-project-empty">暂无此项目对话</div>
                )}
                {orderConversations(project.conversations).map((conversation, i) => {
                  const isCurrent = conversation.active || isSameConversation(current, conversation);
                  const pinnedNow = isPinned(conversation);
                  return (
                    <div
                      key={getConversationKey(conversation, i)}
                      className={`conv-item ${isCurrent ? 'active' : ''} ${pinnedNow ? 'pinned' : ''}`}
                      role="button"
                      tabIndex={0}
                      onClick={() => handleSelect(conversation)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          handleSelect(conversation);
                        }
                      }}
                      aria-current={isCurrent ? 'true' : undefined}
                    >
                      <div className="conv-item-header">
                        <span className={`conv-item-dot ${isCurrent ? 'active' : ''}`} />
                        <span className="conv-item-title">{getDisplayTitle(conversation)}</span>
                        {conversation.mtime && <span className="conv-item-time">{formatRelativeTime(conversation.mtime)}</span>}
                        <button
                          className={`conv-item-pin ${pinnedNow ? 'pinned' : ''}`}
                          onClick={(e) => { e.stopPropagation(); togglePin(conversation); }}
                          title={pinnedNow ? 'Unpin conversation' : 'Pin to top'}
                          aria-label={pinnedNow ? 'Unpin conversation' : 'Pin conversation to top'}
                          aria-pressed={pinnedNow}
                          type="button"
                        >
                          <svg width="13" height="13" viewBox="0 0 24 24" fill={pinnedNow ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" aria-hidden="true">
                            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                          </svg>
                        </button>
                        {isCurrent && (
                          <span className="conv-item-action" title="Current conversation" aria-hidden="true">
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M20 6 9 17l-5-5" />
                            </svg>
                          </span>
                        )}
                      </div>
                      <span className="conv-item-subtitle">
                        {getConversationMeta(conversation)}
                      </span>
                      {conversation.summary && <span className="conv-item-preview">{conversation.summary}</span>}
                    </div>
                  );
                })}
              </div>
              )}
            </div>
            );
          })}

          {hiddenCount > 0 && (
            <button
              className="conv-show-more"
              onClick={(e) => { e.stopPropagation(); setShowAll(true); }}
            >
              Show {hiddenCount} more...
            </button>
          )}

          {filteredProjects.length === 0 && query.trim().length > 0 && (
            <div className="conv-dropdown-empty">No projects or conversations match your search</div>
          )}

          {groupedProjects.length === 0 && (
            <div className="conv-dropdown-empty">No conversations found</div>
          )}
        </div>
      </div>
    </div>
  );
}
