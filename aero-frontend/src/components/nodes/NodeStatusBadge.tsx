function NodeStatusBadge({ isOnline }: { isOnline: boolean }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${
        isOnline ? 'border-emerald-500/40 bg-emerald-600/20 text-emerald-200' : 'border-slate-600/60 bg-slate-700/40 text-slate-200'
      }`}
    >
      {isOnline ? 'online' : 'offline'}
    </span>
  );
}

export default NodeStatusBadge;
