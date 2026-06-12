import { useState, useCallback, useEffect } from 'react';
import type { ArtifactFile } from '@/lib/types';
import { SWR_KEYS } from '@/lib/swr-fetcher';

export function useArtifacts(activeConversationId?: string | null) {
  const [artifactPanelOpen, setArtifactPanelOpen] = useState(false);
  const [artifactFiles, setArtifactFiles] = useState<ArtifactFile[]>([]);

  /** 从非侵入接口拉取计划与产物列表，不点击 PC 端 Artifacts 面板。 */
  const loadArtifacts = useCallback(async () => {
    const res = await fetch(SWR_KEYS.artifacts);
    const data = await res.json();
    const files = Array.isArray(data?.files) ? data.files : [];
    setArtifactFiles(files);
    return data;
  }, []);

  const toggleArtifactPanel = useCallback(() => {
    setArtifactPanelOpen(prev => !prev);
  }, []);

  const openArtifactPanel = useCallback(() => {
    setArtifactPanelOpen(true);
  }, []);

  useEffect(() => {
    let disposed = false;
    const refresh = async () => {
      try {
        if (!disposed) await loadArtifacts();
      } catch {
        // 产物刷新失败不影响聊天主流程。
      }
    };

    void refresh();
    const timer = window.setInterval(refresh, 8000);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [activeConversationId, loadArtifacts]);

  useEffect(() => {
    if (artifactPanelOpen) {
      void loadArtifacts();
    }
  }, [artifactPanelOpen, activeConversationId, loadArtifacts]);

  return {
    artifactFiles,
    artifactPanelOpen,
    toggleArtifactPanel,
    openArtifactPanel,
    loadArtifacts,
  };
}
