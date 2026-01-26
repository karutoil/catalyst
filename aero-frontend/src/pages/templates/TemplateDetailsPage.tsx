import { useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTemplate } from '../../hooks/useTemplates';
import TemplateVariablesList from '../../components/templates/TemplateVariablesList';
import { useAuthStore } from '../../stores/authStore';
import TemplateEditModal from '../../components/templates/TemplateEditModal';

function TemplateDetailsPage() {
  const { templateId } = useParams();
  const { data: template, isLoading, isError } = useTemplate(templateId);
  const { user } = useAuthStore();
  const isAdmin = useMemo(
    () => user?.permissions?.includes('admin.read') || user?.permissions?.includes('*'),
    [user?.permissions],
  );

  if (isLoading) {
    return (
      <div className="rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-6 text-slate-200">
        Loading template...
      </div>
    );
  }

  if (isError || !template) {
    return (
      <div className="rounded-xl border border-rose-800 bg-rose-950/40 px-4 py-6 text-rose-200">
        Unable to load template details.
      </div>
    );
  }

  const iconUrl = template.features?.iconUrl;
  const portList = template.supportedPorts?.length
    ? template.supportedPorts.join(', ')
    : 'n/a';

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-14 w-14 overflow-hidden rounded-lg border border-slate-800 bg-slate-950/80 text-slate-200">
              {iconUrl ? (
                <img src={iconUrl} alt="" className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-sm font-semibold uppercase">
                  {template.name.slice(0, 2)}
                </div>
              )}
            </div>
            <div>
              <h1 className="text-2xl font-semibold text-slate-50">{template.name}</h1>
              <div className="text-sm text-slate-400">
                {template.author} · v{template.version}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <Link
              to="/admin/templates"
              className="rounded-md border border-slate-800 px-3 py-1 font-semibold text-slate-200 hover:border-slate-700"
            >
              Back
            </Link>
            {isAdmin ? (
              <>
                <TemplateEditModal template={template} />
                <span className="rounded-full bg-slate-800 px-3 py-1 text-xs text-slate-300">
                  Admin
                </span>
              </>
            ) : null}
          </div>
        </div>
        {template.description ? (
          <p className="mt-3 text-sm text-slate-300">{template.description}</p>
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-4">
          <div className="text-sm font-semibold text-slate-100">Runtime</div>
          <div className="mt-3 space-y-2 text-xs text-slate-300">
            <div className="flex items-center justify-between gap-4">
              <span>Image</span>
              <span className="text-slate-100">{template.image}</span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span>Install image</span>
              <span className="text-slate-100">{template.installImage ?? 'n/a'}</span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span>Stop command</span>
              <span className="text-slate-100">{template.stopCommand}</span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span>Signal</span>
              <span className="text-slate-100">{template.sendSignalTo}</span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span>Ports</span>
              <span className="text-slate-100">{portList}</span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span>Resources</span>
              <span className="text-slate-100">
                {template.allocatedCpuCores} CPU · {template.allocatedMemoryMb} MB
              </span>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-4">
          <div className="text-sm font-semibold text-slate-100">Startup</div>
          <p className="mt-2 text-xs text-slate-400">
            Variables are substituted before container start.
          </p>
          <div className="mt-3 rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-200">
            {template.startup}
          </div>
          {template.installScript ? (
            <>
              <div className="mt-4 text-sm font-semibold text-slate-100">Install script</div>
              <div className="mt-2 max-h-40 overflow-y-auto rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-200 whitespace-pre-wrap">
                {template.installScript}
              </div>
            </>
          ) : null}
        </div>
      </div>

      <div className="rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-4">
        <div className="text-sm font-semibold text-slate-100">Variables</div>
        <div className="mt-3">
          <TemplateVariablesList variables={template.variables ?? []} />
        </div>
      </div>
    </div>
  );
}

export default TemplateDetailsPage;
