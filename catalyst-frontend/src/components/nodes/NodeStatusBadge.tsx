function NodeStatusBadge({ isOnline }: { isOnline: boolean }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${
        isOnline
          ? 'border-emerald-200 bg-emerald-100 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-400'
          : 'border-slate-200 bg-slate-100 text-slate-600 dark:border-slate-700/60 dark:bg-slate-700/40 dark:text-slate-300'
      }`}
    >
      {isOnline ? 'online' : 'offline'}
    </span>
  );
}

export default NodeStatusBadge;
