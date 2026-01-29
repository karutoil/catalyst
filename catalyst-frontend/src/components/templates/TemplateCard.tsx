import { Link } from 'react-router-dom';
import type { Template } from '../../types/template';
import TemplateDeleteDialog from './TemplateDeleteDialog';

type Props = {
  template: Template;
};

function TemplateCard({ template }: Props) {
  const iconUrl = template.features?.iconUrl;
  const description = template.description?.trim() || 'No description provided.';

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-surface-light transition-all duration-300 hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:shadow-surface-dark dark:hover:border-primary-500/30">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="h-12 w-12 rounded-lg border border-slate-200 bg-slate-50 text-slate-600 overflow-hidden transition-all duration-300 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-200">
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
              className="text-lg font-semibold text-slate-900 transition-all duration-300 hover:text-primary-600 dark:text-white dark:hover:text-primary-400"
            >
              {template.name}
            </Link>
            <div className="text-xs text-slate-500 dark:text-slate-400">
              {template.author} · v{template.version}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link
            to={`/admin/templates/${template.id}`}
            className="rounded-md border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-600 transition-all duration-300 hover:border-primary-500 hover:text-slate-900 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-primary-500/30"
          >
            View
          </Link>
          <TemplateDeleteDialog
            templateId={template.id}
            templateName={template.name}
            buttonClassName="rounded-md border border-rose-200 px-3 py-1 text-xs font-semibold text-rose-600 transition-all duration-300 hover:border-rose-400 dark:border-rose-500/30 dark:text-rose-400"
          />
        </div>
      </div>
      <div className="mt-3 text-xs text-slate-500 dark:text-slate-400 line-clamp-2">
        {description}
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2 text-xs text-slate-600 dark:text-slate-300">
        <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 shadow-surface-light transition-all duration-300 hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:shadow-surface-dark dark:hover:border-primary-500/30">
          <div className="text-slate-500 dark:text-slate-400 dark:text-slate-500">Image</div>
          <div className="text-xs text-slate-900 dark:text-slate-100 truncate">
            {template.image}
          </div>
        </div>
        <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 shadow-surface-light transition-all duration-300 hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:shadow-surface-dark dark:hover:border-primary-500/30">
          <div className="text-slate-500 dark:text-slate-400 dark:text-slate-500">Resources</div>
          <div className="text-xs text-slate-900 dark:text-slate-100">
            {template.allocatedCpuCores} CPU · {template.allocatedMemoryMb} MB
          </div>
        </div>
      </div>
    </div>
  );
}

export default TemplateCard;
