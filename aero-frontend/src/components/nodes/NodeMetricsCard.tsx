import type { NodeStats } from '../../types/node';

function NodeMetricsCard({ stats }: { stats: NodeStats }) {
  const memoryPercent = Math.min(
    100,
    Math.max(
      0,
      stats.resources.actualMemoryTotalMb
        ? (stats.resources.actualMemoryUsageMb / stats.resources.actualMemoryTotalMb) * 100
        : 0,
    ),
  );
  const cpuPercent = Math.min(100, Math.max(0, stats.resources.actualCpuPercent ?? 0));
  const diskPercent = Math.min(
    100,
    Math.max(
      0,
      stats.resources.actualDiskTotalMb
        ? (stats.resources.actualDiskUsageMb / stats.resources.actualDiskTotalMb) * 100
        : 0,
    ),
  );

  const metrics = [
    { label: 'CPU', value: cpuPercent, color: 'bg-sky-500' },
    { label: 'Memory', value: memoryPercent, color: 'bg-emerald-500' },
    { label: 'Disk', value: diskPercent, color: 'bg-amber-500' },
  ];

  return (
    <div className="space-y-3 rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-100">Live usage</h3>
        <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[11px] text-slate-300">Live</span>
      </div>
      {metrics.map((metric) => (
        <div key={metric.label} className="space-y-1">
          <div className="flex items-center justify-between text-xs text-slate-300">
            <span>{metric.label}</span>
            <span className="font-semibold text-slate-100">{metric.value.toFixed(0)}%</span>
          </div>
          <div className="h-2 rounded-full bg-slate-800">
            <div
              className={`h-2 rounded-full ${metric.color}`}
              style={{ width: `${metric.value}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

export default NodeMetricsCard;
