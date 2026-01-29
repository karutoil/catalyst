import { Link } from 'react-router-dom';

function NotFoundPage() {
  return (
    <div className="app-shell flex min-h-screen flex-col items-center justify-center px-4 text-center text-slate-900 dark:text-slate-100">
      <p className="text-sm uppercase tracking-widest text-slate-500 dark:text-slate-400 dark:text-slate-500">404</p>
      <h1 className="mt-2 text-3xl font-semibold">Page not found</h1>
      <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
        The page you are looking for does not exist.
      </p>
      <Link
        to="/dashboard"
        className="mt-6 rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-primary-500/20 transition-all duration-300 hover:bg-primary-500"
      >
        Go to dashboard
      </Link>
    </div>
  );
}

export default NotFoundPage;
