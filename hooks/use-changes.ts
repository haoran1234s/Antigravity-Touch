import { useState, useCallback, useEffect } from 'react';
import type { ChangeFile } from '@/lib/types';
import { SWR_KEYS } from '@/lib/swr-fetcher';

/** 管理修改记录面板数据；默认从 Git 工作区读取，避免点击 PC 端 Changes 面板。 */
export function useChanges() {
  const [changesPanelOpen, setChangesPanelOpen] = useState(false);
  const [changeFiles, setChangeFiles] = useState<ChangeFile[]>([]);
  const [isAccepting, setIsAccepting] = useState(false);
  const [isRejecting, setIsRejecting] = useState(false);

  /** 从非侵入接口拉取 Git 修改记录。 */
  const loadChanges = useCallback(async () => {
    const res = await fetch(SWR_KEYS.changes);
    const data = await res.json();
    const changes = Array.isArray(data?.changes) ? data.changes : [];
    setChangeFiles(changes);
    return data;
  }, []);

  const toggleChangesPanel = useCallback(() => {
    setChangesPanelOpen(prev => !prev);
  }, []);

  useEffect(() => {
    let disposed = false;
    const refresh = async () => {
      try {
        if (!disposed) await loadChanges();
      } catch {
        // 修改记录刷新失败不影响聊天主流程。
      }
    };

    void refresh();
    const timer = window.setInterval(refresh, 8000);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [loadChanges]);

  useEffect(() => {
    if (changesPanelOpen) {
      void loadChanges();
    }
  }, [changesPanelOpen, loadChanges]);

  /** 点击 IDE 的 Accept all 按钮接受全部修改。 */
  const acceptAllChanges = useCallback(async () => {
    setIsAccepting(true);
    try {
      const res = await fetch('/api/v1/changes/accept-all', { method: 'POST' });
      const result = await res.json();
      await new Promise(resolve => setTimeout(resolve, 500));
      await loadChanges();
      return result;
    } catch (e: any) {
      return { success: false, error: e.message };
    } finally {
      setIsAccepting(false);
    }
  }, [loadChanges]);

  /** 点击 IDE 的 Reject all 按钮拒绝全部修改。 */
  const rejectAllChanges = useCallback(async () => {
    setIsRejecting(true);
    try {
      const res = await fetch('/api/v1/changes/reject-all', { method: 'POST' });
      const result = await res.json();
      await new Promise(resolve => setTimeout(resolve, 500));
      await loadChanges();
      return result;
    } catch (e: any) {
      return { success: false, error: e.message };
    } finally {
      setIsRejecting(false);
    }
  }, [loadChanges]);

  return {
    changeFiles,
    changesPanelOpen,
    toggleChangesPanel,
    loadChanges,
    acceptAllChanges,
    rejectAllChanges,
    isAccepting,
    isRejecting,
  };
}
