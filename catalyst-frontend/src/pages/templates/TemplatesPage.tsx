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
  const isAdmin = useMemo(
    () => user?.permissions?.includes('admin.read') || user?.permissions?.includes('*'),
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
    <div className={hideHeader ? '' : 'space-y-4'}>
      {!hideHeader ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-2xl font-semibold text-slate-50">Templates</h1>
              <p className="text-sm text-slate-400">
                Define server templates with images and start commands.
              </p>
            </div>
            {isAdmin ? (
              <TemplateCreateModal />
            ) : (
              <span className="text-xs text-slate-500">Admin access required</span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-800 bg-slate-950/60 px-4 py-3">
            <label className="text-xs text-slate-300">
              Search
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search templates"
                className="mt-1 w-56"
              />
            </label>
          </div>
        </>
      ) : null}
      {isLoading ? (
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-6 text-slate-200">
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
          action={isAdmin ? <TemplateCreateModal /> : null}
        />
      )}
    </div>
  );
}

export default TemplatesPage;
