import { useMemo, useState } from 'react';
import { useTemplates } from '../../hooks/useTemplates';
import TemplateCreateModal from '../../components/templates/TemplateCreateModal';
import TemplateList from '../../components/templates/TemplateList';
import EmptyState from '../../components/shared/EmptyState';
import Input from '../../components/ui/input';
import { useAuthStore } from '../../stores/authStore';

type Props = {
  hideHeader?: boolean;
};

function TemplatesPage({ hideHeader }: Props) {
  const { data: templates = [], isLoading } = useTemplates();
  const [search, setSearch] = useState('');
  const { user } = useAuthStore();
  const canWrite = useMemo(
    () => user?.permissions?.includes('admin.write') || user?.permissions?.includes('*'),
    [user?.permissions],
  );
  const filteredTemplates = useMemo(() => {
    if (!search.trim()) return templates;
    const query = search.trim().toLowerCase();
    return templates.filter(
      (template) =>
        template.name.toLowerCase().includes(query) ||
        template.author.toLowerCase().includes(query),
    );
  }, [templates, search]);

  return (
    <div className={hideHeader ? '' : 'space-y-6'}>
      {!hideHeader ? (
        <>
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-surface-light transition-all duration-300 hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900/70 dark:shadow-surface-dark dark:hover:border-primary-500/30">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">Templates</h1>
                <p className="text-sm text-slate-600 dark:text-slate-400">
                  Define server templates with images and start commands.
                </p>
              </div>
              {canWrite ? (
                <TemplateCreateModal />
              ) : (
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  Admin access required
                </span>
              )}
            </div>
            <div className="mt-4 flex flex-wrap gap-2 text-xs text-slate-600 dark:text-slate-400">
              <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 dark:border-slate-800 dark:bg-slate-950/60">
                {templates.length} templates available
              </span>
              <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 dark:border-slate-800 dark:bg-slate-950/60">
                {filteredTemplates.length} shown
              </span>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-surface-light dark:shadow-surface-dark transition-all duration-300 hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-primary-500/30">
            <label className="text-xs text-slate-600 dark:text-slate-300">
              Search
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search templates"
                className="mt-1 w-56"
              />
            </label>
            <div className="text-xs text-slate-500 dark:text-slate-400">
              Showing {filteredTemplates.length} template
              {filteredTemplates.length === 1 ? '' : 's'}
            </div>
          </div>
        </>
      ) : null}
      {isLoading ? (
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-6 text-slate-600 shadow-surface-light dark:shadow-surface-dark transition-all duration-300 hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-primary-500/30">
          Loading templates...
        </div>
      ) : filteredTemplates.length ? (
        <TemplateList templates={filteredTemplates} />
      ) : (
        <EmptyState
          title={search.trim() ? 'No templates found' : 'No templates'}
          description={
            search.trim()
              ? 'Try a different template name or author.'
              : 'Create a template to bootstrap new game servers quickly.'
          }
          action={canWrite ? <TemplateCreateModal /> : null}
        />
      )}
    </div>
  );
}

export default TemplatesPage;
