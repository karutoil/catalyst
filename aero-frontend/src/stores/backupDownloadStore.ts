import { create } from 'zustand';

type Progress = { loaded: number; total?: number };

interface BackupDownloadState {
  progressByBackup: Record<string, Progress>;
  setProgress: (key: string, progress: Progress) => void;
  clearProgress: (key: string) => void;
}

export const useBackupDownloadStore = create<BackupDownloadState>((set) => ({
  progressByBackup: {},
  setProgress: (key, progress) =>
    set((state) => ({
      progressByBackup: { ...state.progressByBackup, [key]: progress },
    })),
  clearProgress: (key) =>
    set((state) => {
      if (!state.progressByBackup[key]) {
        return state;
      }
      const next = { ...state.progressByBackup };
      delete next[key];
      return { progressByBackup: next };
    }),
}));
