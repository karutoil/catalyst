export const formatBytes = (bytes: number) => {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** index;
  return `${value.toFixed(1)} ${units[index]}`;
};

export const formatPercent = (value: number) => `${value.toFixed(0)}%`;

export const formatFileMode = (mode?: number) => {
  if (!Number.isFinite(mode)) return '---';
  const safeMode = mode as number;
  return safeMode.toString(8).padStart(3, '0');
};

export const formatBackupSize = (sizeMb: number) => formatBytes(sizeMb * 1024 * 1024);
