import { Link } from 'react-router-dom';
import type { Template } from '../../types/template';

type Props = {
  template: Template;
};

function TemplateCard({ template }: Props) {
  const iconUrl = template.features?.iconUrl;
  const description = template.description?.trim() || 'No description provided.';

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="h-12 w-12 rounded-lg border border-slate-800 bg-slate-950/80 text-slate-200 overflow-hidden">
            {iconUrl ? (
              <img src={iconUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-xs font-semibold uppercase">
                {template.name.slice(0, 2)}
              </div>
            )}
          </div>
          <div>
            <Link
              to={`/admin/templates/${template.id}`}
              className="text-lg font-semibold text-slate-50 hover:text-white"
            >
              {template.name}
            </Link>
            <div className="text-xs text-slate-400">
              {template.author} · v{template.version}
            </div>
          </div>
        </div>
        <Link
          to={`/admin/templates/${template.id}`}
          className="rounded-md border border-slate-800 bg-slate-900 px-3 py-1 text-xs font-semibold text-slate-200 hover:border-slate-700"
        >
          View
        </Link>
      </div>
      <div className="mt-3 text-xs text-slate-400 line-clamp-2">{description}</div>
      <div className="mt-4 grid grid-cols-2 gap-2 text-xs text-slate-300">
        <div className="rounded-md border border-slate-800 bg-slate-900 px-3 py-2">
          <div className="text-slate-400">Image</div>
          <div className="text-xs text-slate-100 truncate">{template.image}</div>
        </div>
        <div className="rounded-md border border-slate-800 bg-slate-900 px-3 py-2">
          <div className="text-slate-400">Resources</div>
          <div className="text-xs text-slate-100">
            {template.allocatedCpuCores} CPU · {template.allocatedMemoryMb} MB
          </div>
        </div>
      </div>
    </div>
  );
}

export default TemplateCard;
