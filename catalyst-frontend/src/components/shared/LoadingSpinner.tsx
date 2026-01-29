function LoadingSpinner() {
  return (
    <div className="flex items-center justify-center py-10 text-slate-500 dark:text-slate-300">
      <div className="h-10 w-10 animate-spin rounded-full border-4 border-slate-200 border-t-primary-500 dark:border-slate-700 dark:border-t-primary-400" />
    </div>
  );
}

export default LoadingSpinner;
