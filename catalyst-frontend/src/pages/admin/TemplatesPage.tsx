import AdminTabs from '../../components/admin/AdminTabs';
import TemplatesPage from '../templates/TemplatesPage';

function AdminTemplatesPage() {
  return (
    <div className="space-y-6">
      <AdminTabs />
      <TemplatesPage />
    </div>
  );
}

export default AdminTemplatesPage;
