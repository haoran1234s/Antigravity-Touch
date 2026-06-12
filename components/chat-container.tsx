'use client';

import { useChat } from '@/hooks/use-chat';
import Header from '@/components/header';
import WelcomeScreen from '@/components/welcome-screen';
import MessageList from '@/components/message-list';
import ChatInput from '@/components/chat-input';
import ArtifactPanel from '@/components/artifact-panel';
import ChangesPanel from '@/components/changes-panel';
import GitPanel from '@/components/git-panel';
import WorkspacePanel from '@/components/workspace-panel';
import NetworkBanner from '@/components/network-banner';
import { useEffect, useCallback } from 'react';

export default function ChatContainer() {
  const chat = useChat();

  // Destructure all values used in JSX to avoid "Cannot access refs during render" lint errors.
  // The useChat hook mixes ref-backed and state-backed values in its return object.
  const {
    statusState, statusText, windows, conversations, conversationProjects, activeConversation,
    isLoadingConversations, conversationSyncError, cdpStatus, recentProjects, selectWindow, selectConversation, loadConversations,
    startNewChat, startCdpServer, openNewWindow, closeWindowByIndex,
    networkOnline, isConnected, isMonitorConnected, isLoadingHistory, showWelcome,
    messages, currentSteps, currentResponse, isStreaming,
    sendMessage, stopStreaming, currentMode, toggleMode,
    currentAgent, agents, isLoadingAgents, fetchAgentList, switchAgent,
    syncDesktopState, isSyncingDesktop,
    toggleArtifactPanel, artifactFiles, artifactPanelOpen,
    toggleChangesPanel, changeFiles, changesPanelOpen,
    acceptAllChanges, rejectAllChanges, isAccepting, isRejecting,
    gitStatus, gitPanelOpen, gitChangedCount, toggleGitPanel, refreshGit,
    workspaceTree, workspacePanelOpen, workspaceLoading, toggleWorkspacePanel, refreshWorkspace,
    messagesEndRef,
  } = chat;

  const handleRetry = useCallback(async () => {
    try {
      await fetch('/api/v1/health');
      window.location.reload();
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'n' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        startNewChat();
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [startNewChat]);

  return (
    <div className="app-container">
      <Header
        statusState={statusState}
        statusText={statusText}
        windows={windows}
        conversations={conversations}
        conversationProjects={conversationProjects}
        activeConversation={activeConversation}
        isLoadingConversations={isLoadingConversations}
        conversationSyncError={conversationSyncError}
        isMonitorConnected={isMonitorConnected}
        cdpStatus={cdpStatus}
        recentProjects={recentProjects}
        onSelectWindow={selectWindow}
        onSelectConversation={selectConversation}
        onLoadConversations={loadConversations}
        onNewChat={startNewChat}
        onStartCdp={startCdpServer}
        onOpenWindow={openNewWindow}
        onCloseWindow={closeWindowByIndex}
      />

      <NetworkBanner networkOnline={networkOnline} isConnected={isConnected} />

      <main className="messages-area" role="log" aria-live="polite">
        {isLoadingHistory ? (
          <div className="history-loading">
            <div className="history-loading-header">
              <div className="skeleton-shimmer skeleton-avatar" />
              <div className="skeleton-shimmer skeleton-line" style={{ width: '45%' }} />
            </div>
            <div className="history-loading-block">
              <div className="skeleton-shimmer skeleton-line" style={{ width: '80%' }} />
              <div className="skeleton-shimmer skeleton-line" style={{ width: '65%' }} />
              <div className="skeleton-shimmer skeleton-line" style={{ width: '72%' }} />
            </div>
            <div className="history-loading-header right">
              <div className="skeleton-shimmer skeleton-line" style={{ width: '35%' }} />
            </div>
            <div className="history-loading-block">
              <div className="skeleton-shimmer skeleton-line" style={{ width: '90%' }} />
              <div className="skeleton-shimmer skeleton-line" style={{ width: '55%' }} />
              <div className="skeleton-shimmer skeleton-line" style={{ width: '68%' }} />
              <div className="skeleton-shimmer skeleton-line" style={{ width: '40%' }} />
            </div>
            <div className="history-loading-header">
              <div className="skeleton-shimmer skeleton-avatar" />
              <div className="skeleton-shimmer skeleton-line" style={{ width: '50%' }} />
            </div>
            <div className="history-loading-block">
              <div className="skeleton-shimmer skeleton-line" style={{ width: '75%' }} />
              <div className="skeleton-shimmer skeleton-line" style={{ width: '60%' }} />
            </div>
            <p className="history-loading-text">Loading conversation history…</p>
          </div>
        ) : showWelcome ? (
          <WelcomeScreen onQuickPrompt={sendMessage} />
        ) : (
          <MessageList
            messages={messages}
            currentSteps={currentSteps}
            currentResponse={currentResponse}
            isStreaming={isStreaming}
            onRetry={handleRetry}
          />
        )}
        <div ref={messagesEndRef} />
      </main>

      <ChatInput
        onSend={sendMessage}
        onStop={stopStreaming}
        isStreaming={isStreaming}
        currentMode={currentMode}
        onToggleMode={toggleMode}
        currentAgent={currentAgent}
        agents={agents}
        isLoadingAgents={isLoadingAgents}
        onFetchAgents={fetchAgentList}
        onSwitchAgent={switchAgent}
        onSyncDesktop={syncDesktopState}
        isSyncingDesktop={isSyncingDesktop}
        onToggleArtifacts={toggleArtifactPanel}
        artifactCount={artifactFiles.length}
        artifactPanelOpen={artifactPanelOpen}
        onToggleChanges={toggleChangesPanel}
        changesCount={changeFiles.length}
        changesPanelOpen={changesPanelOpen}
        onToggleGit={toggleGitPanel}
        gitChangedCount={gitChangedCount}
        gitPanelOpen={gitPanelOpen}
        onToggleWorkspace={toggleWorkspacePanel}
        workspacePanelOpen={workspacePanelOpen}
      />

      <ArtifactPanel
        open={artifactPanelOpen}
        onClose={toggleArtifactPanel}
        activeConversation={activeConversation}
        files={artifactFiles}
      />

      <ChangesPanel
        open={changesPanelOpen}
        onClose={toggleChangesPanel}
        changes={changeFiles}
        onAcceptAll={acceptAllChanges}
        onRejectAll={rejectAllChanges}
        isAccepting={isAccepting}
        isRejecting={isRejecting}
      />

      <GitPanel
        open={gitPanelOpen}
        onClose={toggleGitPanel}
        gitStatus={gitStatus}
        onRefresh={refreshGit}
      />

      <WorkspacePanel
        open={workspacePanelOpen}
        onClose={toggleWorkspacePanel}
        workspaceTree={workspaceTree}
        workspaceLoading={workspaceLoading}
        onRefresh={refreshWorkspace}
      />
    </div>
  );
}
