import { Link, useLocation } from 'react-router-dom';

const labelMap: Record<string, string> = {
  dashboard: 'Dashboard',
  nodes: 'Nodes',
  templates: 'Templates',
  alerts: 'Alerts',
  admin: 'Admin',
  users: 'Users',
  servers: 'Servers',
  system: 'System',
  network: 'Network',
  'audit-logs': 'Audit Logs',
  files: 'Files',
  console: 'Console',
};

function Breadcrumbs() {
  const location = useLocation();
  const segments = location.pathname.split('/').filter(Boolean);

  const crumbs = segments.map((segment, index) => {
    const href = `/${segments.slice(0, index + 1).join('/')}`;
    const label = labelMap[segment] ?? segment;
    return { href, label, isLast: index === segments.length - 1 };
  });

  if (crumbs.length === 0) {
    return null;
  }

  return (
    <nav className="text-sm text-slate-500 dark:text-slate-400" aria-label="Breadcrumb">
      <ol className="flex items-center gap-2">
        <li>
          <Link className="font-medium text-slate-600 dark:text-slate-200 hover:text-white" to="/dashboard">
            Dashboard
          </Link>
        </li>
        {crumbs.map((crumb) => (
          <li key={crumb.href} className="flex items-center gap-2">
            <span className="text-slate-600">/</span>
            {crumb.isLast ? (
              <span className="font-semibold text-slate-900 dark:text-slate-100">{crumb.label}</span>
            ) : (
              <Link className="font-medium text-slate-600 dark:text-slate-200 hover:text-white" to={crumb.href}>
                {crumb.label}
              </Link>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

export default Breadcrumbs;
