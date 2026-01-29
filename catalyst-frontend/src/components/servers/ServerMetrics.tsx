type Metric = {
  label: string;
  value: number;
  color: string;
};

function ServerMetrics({ cpu = 0, memory = 0 }: { cpu?: number; memory?: number }) {
  const metrics: Metric[] = [
    { label: 'CPU', value: cpu, color: 'bg-primary-500' },
    { label: 'Memory', value: memory, color: 'bg-emerald-500' },
  ];

  return (
    <div className="space-y-3 rounded-xl border border-slate-200 bg-white px-4 py-4 shadow-surface-light transition-all duration-300 hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:shadow-surface-dark dark:hover:border-primary-500/30">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Resource usage</h3>
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600 dark:bg-slate-800 dark:text-slate-300">
          Live
        </span>
      </div>
      {metrics.map((metric) => (
        <div key={metric.label} className="space-y-1">
          <div className="flex items-center justify-between text-xs text-slate-600 dark:text-slate-300">
            <span>{metric.label}</span>
            <span className="font-semibold text-slate-900 dark:text-slate-100">
              {metric.value.toFixed(0)}%
            </span>
          </div>
          <div className="h-2 rounded-full bg-slate-200 dark:bg-slate-800">
            <div
              className={`h-2 rounded-full ${metric.color}`}
              style={{ width: `${Math.min(100, Math.max(0, metric.value))}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

export default ServerMetrics;
