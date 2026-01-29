type Props = {
  title: string;
  description?: string;
  action?: React.ReactNode;
};

function EmptyState({ title, description, action }: Props) {
  return (
    <div className="rounded-lg border border-dashed border-slate-200 bg-white px-6 py-10 text-center shadow-surface-light dark:shadow-surface-dark transition-all duration-300 hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-primary-500/30">
      <h3 className="text-lg font-semibold text-slate-900 dark:text-white">{title}</h3>
      {description ? (
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">{description}</p>
      ) : null}
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}

export default EmptyState;
