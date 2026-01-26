import AdminTabs from '../../components/admin/AdminTabs';
import TemplatesPage from '../templates/TemplatesPage';

function AdminTemplatesPage() {
  return (
    <div className="space-y-4">
      <AdminTabs />
      <h1 className="text-2xl font-semibold text-slate-50">Templates</h1>
      <TemplatesPage hideHeader />
    </div>
  );
}

export default AdminTemplatesPage;
