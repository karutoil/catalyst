import { useMemo } from 'react';
import { useTemplates } from '../../hooks/useTemplates';
import TemplateCreateModal from '../../components/templates/TemplateCreateModal';
import TemplateList from '../../components/templates/TemplateList';
import EmptyState from '../../components/shared/EmptyState';
import { useAuthStore } from '../../stores/authStore';

type Props = {
  hideHeader?: boolean;
};

function TemplatesPage({ hideHeader }: Props) {
  const { data: templates = [], isLoading } = useTemplates();
  const { user } = useAuthStore();
  const isAdmin = useMemo(
    () => user?.permissions?.includes('admin.read') || user?.permissions?.includes('*'),
    [user?.permissions],
  );

  return (
    <div className={hideHeader ? '' : 'space-y-4'}>
      {!hideHeader ? (
        <div className="flex items-center justify-between">
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
      ) : null}
      {isLoading ? (
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-6 text-slate-200">
          Loading templates...
        </div>
      ) : templates.length ? (
        <TemplateList templates={templates} />
      ) : (
        <EmptyState
          title="No templates"
          description="Create a template to bootstrap new game servers quickly."
          action={isAdmin ? <TemplateCreateModal /> : null}
        />
      )}
    </div>
  );
}

export default TemplatesPage;
