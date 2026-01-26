import type { TemplateVariable } from '../../types/template';

type Props = {
  variables: TemplateVariable[];
};

function TemplateVariablesList({ variables }: Props) {
  if (!variables.length) {
    return <div className="text-sm text-slate-500">No variables defined.</div>;
  }

  return (
    <div className="space-y-3">
      {variables.map((variable) => (
        <div key={variable.name} className="rounded-lg border border-slate-800 bg-slate-900 px-3 py-2">
          <div className="flex items-center justify-between gap-2">
            <div className="text-sm font-semibold text-slate-100">
              {variable.name}
              {variable.required ? <span className="ml-1 text-xs text-rose-400">*</span> : null}
            </div>
            <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[11px] text-slate-300">
              {variable.input ?? 'text'}
            </span>
          </div>
          {variable.description ? (
            <div className="mt-1 text-xs text-slate-400">{variable.description}</div>
          ) : null}
          <div className="mt-2 text-xs text-slate-500">
            Default: <span className="text-slate-300">{variable.default || '—'}</span>
          </div>
          {variable.rules?.length ? (
            <div className="mt-1 text-xs text-slate-500">
              Rules: <span className="text-slate-300">{variable.rules.join(', ')}</span>
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

export default TemplateVariablesList;
