'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import QuickCommands from './quick-commands';
import { useSpeechRecognition } from '@/hooks/use-speech-recognition';

const SEND_ON_ENTER_KEY = 'at_send_on_enter';

interface AgentOption {
  name: string;
  active: boolean;
  description?: string;
}

interface UploadedFileInfo {
  name: string;
  path: string;
  size: number;
  type?: string;
}

interface ChatInputProps {
  onSend: (text: string) => void;
  onStop: () => void;
  isStreaming: boolean;
  currentMode: 'planning' | 'fast';
  onToggleMode: () => void;
  currentAgent: string | null;
  agents: AgentOption[];
  isLoadingAgents: boolean;
  onFetchAgents: () => void;
  onSwitchAgent: (agentName: string) => void;
  onSyncDesktop: () => void | Promise<void>;
  isSyncingDesktop: boolean;
  onToggleArtifacts: () => void;
  artifactCount: number;
  artifactPanelOpen: boolean;
  onToggleChanges: () => void;
  changesCount: number;
  changesPanelOpen: boolean;
  onToggleGit: () => void;
  gitChangedCount: number;
  gitPanelOpen: boolean;
  onToggleWorkspace: () => void;
  workspacePanelOpen: boolean;
}

export default function ChatInput({
  onSend, onStop, isStreaming, currentMode, onToggleMode,
  currentAgent, agents, isLoadingAgents, onFetchAgents, onSwitchAgent,
  onSyncDesktop, isSyncingDesktop,
  onToggleArtifacts, artifactCount, artifactPanelOpen,
  onToggleChanges, changesCount, changesPanelOpen,
  onToggleGit, gitChangedCount, gitPanelOpen,
  onToggleWorkspace, workspacePanelOpen,
}: ChatInputProps) {
  const [value, setValue] = useState('');
  const [agentDropdownOpen, setAgentDropdownOpen] = useState(false);
  const [sendOnEnter, setSendOnEnter] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [toolbarScroll, setToolbarScroll] = useState({ left: false, right: false });
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const agentDropdownRef = useRef<HTMLDivElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);

  // 记录工具栏横向滚动位置，用于显示两侧还有按钮的渐隐提示。
  useEffect(() => {
    const el = toolbarRef.current;
    if (!el) return;
    const update = () => {
      setToolbarScroll({
        left: el.scrollLeft > 1,
        right: el.scrollLeft + el.clientWidth < el.scrollWidth - 1,
      });
    };
    update();
    el.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
      ro.disconnect();
    };
  }, []);

  // 读取 Enter 发送偏好；默认 Enter 发送，贴近常见聊天应用。
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(SEND_ON_ENTER_KEY);
      if (stored === 'false') setSendOnEnter(false);
    } catch {
      // 本地存储可能不可用。
    }
  }, []);

  const toggleSendMode = () => {
    setSendOnEnter((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(SEND_ON_ENTER_KEY, String(next));
      } catch {
        // 忽略本地存储写入失败。
      }
      return next;
    });
    textareaRef.current?.focus();
  };

  /** 将文本追加到当前草稿后聚焦输入框。 */
  const insertText = useCallback((text: string) => {
    setValue((prev) => {
      const sep = prev && !prev.endsWith(' ') && !prev.endsWith('\n') ? ' ' : '';
      return prev + sep + text;
    });
    const el = textareaRef.current;
    if (el) {
      el.focus();
      requestAnimationFrame(() => {
        el.style.height = 'auto';
        el.style.height = Math.min(el.scrollHeight, 150) + 'px';
      });
    }
  }, []);

  /** 将上传结果写入输入框，方便 Agent 读取本地文件路径。 */
  const insertUploadResult = useCallback((files: UploadedFileInfo[]) => {
    const lines = files.map((file) => `- ${file.name}: ${file.path}`).join('\n');
    setValue((prev) => {
      const prefix = prev.trim() ? `${prev.trimEnd()}\n\n` : '';
      return `${prefix}已上传文件：\n${lines}\n请根据这些文件继续处理。`;
    });
    const el = textareaRef.current;
    if (el) {
      el.focus();
      requestAnimationFrame(() => {
        el.style.height = 'auto';
        el.style.height = `${Math.min(el.scrollHeight, 150)}px`;
      });
    }
  }, []);

  const { supported: voiceSupported, listening, toggle: toggleVoice } = useSpeechRecognition({
    onTranscript: insertText,
  });

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setValue(e.target.value);
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 150) + 'px';
  };

  const submitMessage = () => {
    if (value.trim()) {
      // 空闲和生成中都可发送；生成中的打断逻辑由 sendMessage 统一处理。
      onSend(value);
      setValue('');
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
      }
    } else if (isStreaming) {
      // 生成中且输入为空时，发送按钮作为停止按钮。
      onStop();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Escape' && isStreaming) {
      e.preventDefault();
      onStop();
      return;
    }
    if (e.key !== 'Enter') return;
    // 输入法组词期间不提交，避免中文/日文候选词被 Enter 误发送。
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;

    if (sendOnEnter) {
      // Enter 发送，Shift+Enter 换行，Ctrl/Cmd+Enter 也发送。
      if (e.shiftKey) return;
      e.preventDefault();
      submitMessage();
    } else {
      // 兼容模式：组合键发送，普通 Enter 换行。
      if (e.shiftKey || e.ctrlKey || e.metaKey) {
        e.preventDefault();
        submitMessage();
      }
    }
  };

  const handleSend = () => {
    if (value.trim()) {
      // 有文本时发送；若正在生成则由 sendMessage 负责打断。
      onSend(value);
      setValue('');
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
      }
    } else if (isStreaming) {
      // 输入为空且正在生成时，点击发送按钮表示停止。
      onStop();
    }
  };

  const handleSyncClick = () => {
    void onSyncDesktop();
  };

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (files.length === 0) return;

    const formData = new FormData();
    files.forEach((file) => formData.append('files', file));

    setIsUploading(true);
    try {
      const res = await fetch('/api/v1/uploads', {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      if (!res.ok || !Array.isArray(data.files) || data.files.length === 0) {
        throw new Error(data.error || '上传失败');
      }
      insertUploadResult(data.files);
    } catch (err: any) {
      setValue((prev) => {
        const prefix = prev.trim() ? `${prev.trimEnd()}\n` : '';
        return `${prefix}上传失败：${err?.message || '未知错误'}`;
      });
    } finally {
      setIsUploading(false);
    }
  };

  const handleAgentClick = () => {
    if (!agentDropdownOpen) {
      onFetchAgents();
    }
    setAgentDropdownOpen(!agentDropdownOpen);
  };

  const handleAgentSelect = (agentName: string) => {
    onSwitchAgent(agentName);
    setAgentDropdownOpen(false);
  };

  // 点击模型选择器外部时关闭下拉层。
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      const clickedSelector = dropdownRef.current?.contains(target);
      const clickedDropdown = agentDropdownRef.current?.contains(target);
      if (!clickedSelector && !clickedDropdown) {
        setAgentDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  /** 模型按钮上显示的短标签。 */
  const agentLabel = currentAgent
    ? currentAgent.replace(/^(Claude\s+|Google\s+|OpenAI\s+)/i, '').substring(0, 20)
    : 'Agent';

  return (
    <footer className="input-area">
      {/* 工具栏：模型选择、模式、同步、附件与面板入口。 */}
      <div className={`input-toolbar-wrap${toolbarScroll.left ? ' can-scroll-left' : ''}${toolbarScroll.right ? ' can-scroll-right' : ''}`}>
      <div className="input-toolbar" ref={toolbarRef}>
        <div ref={dropdownRef} className={`agent-selector-wrapper ${agentDropdownOpen ? 'open' : ''}`}>
          <button
            className="agent-selector-btn"
            onClick={handleAgentClick}
            title={currentAgent ? `Agent: ${currentAgent} — Click to switch` : 'Select AI agent'}
            aria-label={`Switch agent (currently ${currentAgent || 'unknown'})`}
            type="button"
          >
            <span className="agent-icon">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 2a4 4 0 0 1 4 4v2a4 4 0 0 1-8 0V6a4 4 0 0 1 4-4z" />
                <path d="M20 21v-2a4 4 0 0 0-3-3.87" />
                <path d="M4 21v-2a4 4 0 0 1 3-3.87" />
                <circle cx="12" cy="17" r="1" />
                <path d="M9 17h6" />
              </svg>
            </span>
            <span className="agent-label">{agentLabel}</span>
            <svg className={`agent-chevron ${agentDropdownOpen ? 'open' : ''}`} width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>

        </div>

        <button
          className={`mode-toggle ${currentMode}`}
          onClick={onToggleMode}
          title={`Mode: ${currentMode === 'planning' ? 'Planning' : 'Fast'} — Click to switch`}
          aria-label={`Switch mode (currently ${currentMode})`}
          type="button"
        >
          <span className="mode-icon">
            {currentMode === 'planning' ? (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="16" y1="13" x2="8" y2="13" />
                <line x1="16" y1="17" x2="8" y2="17" />
              </svg>
            ) : (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
              </svg>
            )}
          </span>
          <span className="mode-label">{currentMode === 'planning' ? 'Plan' : 'Fast'}</span>
        </button>

        <button
          className={`artifact-toggle-btn ${isSyncingDesktop ? 'active' : ''}`}
          onClick={handleSyncClick}
          title="同步当前 PC 对话状态"
          aria-label="同步当前 PC 对话状态"
          disabled={isSyncingDesktop}
          type="button"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 12a9 9 0 0 1-15.3 6.4" />
            <path d="M3 12A9 9 0 0 1 18.3 5.6" />
            <polyline points="8 18 5.7 18.4 5.3 20.7" />
            <polyline points="16 6 18.3 5.6 18.7 3.3" />
          </svg>
          <span className="toolbar-btn-label">{isSyncingDesktop ? '同步中' : '同步'}</span>
        </button>

        <button
          className="artifact-toggle-btn"
          onClick={handleUploadClick}
          title="上传截图或文件"
          aria-label="上传截图或文件"
          disabled={isUploading}
          type="button"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
          <span className="toolbar-btn-label">{isUploading ? '上传中' : '上传'}</span>
        </button>

        {/* 计划与产物面板入口 */}
        <button
          className={`artifact-toggle-btn ${artifactPanelOpen ? 'active' : ''}`}
          onClick={onToggleArtifacts}
          title={`计划与产物${artifactCount > 0 ? ` (${artifactCount})` : ''}`}
          aria-label="打开计划与产物面板"
          type="button"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="16" y1="13" x2="8" y2="13" />
            <line x1="16" y1="17" x2="8" y2="17" />
          </svg>
          <span className="toolbar-btn-label">计划</span>
          {artifactCount > 0 && (
            <span className="artifact-badge">{artifactCount}</span>
          )}
        </button>

        {/* 修改记录面板入口 */}
        <button
          className={`changes-toggle-btn ${changesPanelOpen ? 'active' : ''}`}
          onClick={onToggleChanges}
          title={`修改记录${changesCount > 0 ? ` (${changesCount})` : ''}`}
          aria-label="打开修改记录面板"
          type="button"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
          </svg>
          <span className="toolbar-btn-label">修改</span>
          {changesCount > 0 && (
            <span className="changes-badge">{changesCount}</span>
          )}
        </button>

        {/* Git 状态面板入口 */}
        <button
          className={`git-toggle-btn ${gitPanelOpen ? 'active' : ''}`}
          onClick={onToggleGit}
          title={`Git${gitChangedCount > 0 ? ` (${gitChangedCount} changed)` : ''}`}
          aria-label="Toggle git panel"
          type="button"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="18" cy="18" r="3" />
            <circle cx="6" cy="6" r="3" />
            <path d="M13 6h3a2 2 0 0 1 2 2v7" />
            <line x1="6" y1="9" x2="6" y2="21" />
          </svg>
          <span className="toolbar-btn-label">Git</span>
          {gitChangedCount > 0 && (
            <span className="git-badge">{gitChangedCount}</span>
          )}
        </button>

        {/* 工作目录面板入口 */}
        <button
          className={`workspace-toggle-btn ${workspacePanelOpen ? 'active' : ''}`}
          onClick={onToggleWorkspace}
          title="Working Directory"
          aria-label="Toggle working directory panel"
          type="button"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
          </svg>
          <span className="toolbar-btn-label">Files</span>
        </button>

        {/* 快捷指令入口 */}
        <QuickCommands onInsert={insertText} />

      </div>

      {/* 模型下拉层渲染在横向滚动工具栏外部，避免移动端被 overflow 裁剪。 */}
      <div
        ref={agentDropdownRef}
        className={`agent-dropdown ${agentDropdownOpen ? 'open' : ''}`}
        style={agentDropdownOpen ? { opacity: 1, transform: 'translateY(0) scale(1)', pointerEvents: 'auto' } : undefined}
      >
        <div className="agent-dropdown-header">Select Agent</div>
        {isLoadingAgents ? (
          <div className="agent-dropdown-loading">
            <span className="wm-spinner" />
            <span>Loading agents...</span>
          </div>
        ) : agents.length === 0 ? (
          <div className="agent-dropdown-empty">
            No agents detected. Make sure the IDE has a workbench open.
          </div>
        ) : (
          <div className="agent-dropdown-list">
            {agents.map((agent, idx) => (
              <button
                key={idx}
                className={`agent-option ${agent.active ? 'active' : ''} ${currentAgent === agent.name ? 'current' : ''}`}
                onClick={() => handleAgentSelect(agent.name)}
                type="button"
              >
                <span className="agent-option-name">{agent.name}</span>
                {agent.description && (
                  <span className="agent-option-desc">{agent.description}</span>
                )}
                {(agent.active || currentAgent === agent.name) && (
                  <svg className="agent-check" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        multiple
        hidden
        onChange={handleFileChange}
      />

      {/* 文本输入行：输入框、语音与发送按钮。 */}
      <div className="input-wrapper">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          placeholder="Ask the Antigravity agent..."
          rows={1}
          aria-label="Chat message input"
          enterKeyHint={sendOnEnter ? 'send' : 'enter'}
          autoComplete="off"
        />

        {voiceSupported && (
          <button
            className={`voice-btn ${listening ? 'listening' : ''}`}
            onClick={toggleVoice}
            aria-label={listening ? 'Stop dictation' : 'Start voice dictation'}
            title={listening ? 'Stop dictation' : 'Voice input'}
            type="button"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <line x1="12" y1="19" x2="12" y2="23" />
              <line x1="8" y1="23" x2="16" y2="23" />
            </svg>
          </button>
        )}

        <button
          className={`send-btn${isStreaming && value.trim()
              ? ' send-btn--interrupt'
              : isStreaming
                ? ' send-btn--stop'
                : ''
            }`}
          onClick={handleSend}
          disabled={!isStreaming && !value.trim()}
          aria-label={
            isStreaming && value.trim()
              ? 'Interrupt and send new message'
              : isStreaming
                ? 'Stop generation'
                : 'Send message'
          }
          title={
            isStreaming && value.trim()
              ? 'Interrupt agent and send new message'
              : isStreaming
                ? 'Stop generation (Esc)'
                : 'Send message'
          }
        >
          {isStreaming && !value.trim() ? (
            /* 停止图标：实心方块。 */
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <rect x="4" y="4" width="16" height="16" rx="3" />
            </svg>
          ) : (
            /* 发送图标：空闲与生成中均可使用。 */
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          )}
        </button>
      </div>
      <div className="input-hint">
        <span>
          {sendOnEnter
            ? 'Enter to send · Shift+Enter for new line'
            : 'Shift+Enter to send · Enter for new line'}
          {' · Ctrl+N for new chat · Esc to stop'}
        </span>
        <button
          className="send-mode-toggle"
          onClick={toggleSendMode}
          type="button"
          title="Switch how Enter behaves"
          aria-label={`Enter currently ${sendOnEnter ? 'sends the message' : 'inserts a new line'}. Click to switch.`}
        >
          {sendOnEnter ? 'Enter sends' : 'Shift+Enter sends'}
        </button>
      </div>
    </footer>
  );
}
