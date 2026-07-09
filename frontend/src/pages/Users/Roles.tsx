
import { FiShield } from 'react-icons/fi';
import PageMeta from '../../components/common/PageMeta';

export default function Roles() {
  return (
    <>
      <PageMeta title="Roles & Permissions | Synapse PIMS" description="Manage roles and permissions" />
      <div className="p-4 md:p-6 2xl:p-10 bg-[#f8f9fc] min-h-screen">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-8">
          <div>
            <h2 className="text-2xl font-bold text-gray-900 tracking-tight flex items-center gap-2">
              <div className="w-10 h-10 rounded-xl bg-orange-100 text-orange-600 flex items-center justify-center mr-2">
                <FiShield size={20} />
              </div>
              Roles & Permissions
            </h2>
            <p className="text-sm text-gray-500 mt-2">Manage access levels for users in the system.</p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Admin Role */}
          <div className="bg-white rounded-3xl border border-gray-100 p-6 shadow-sm">
            <h3 className="text-lg font-bold text-gray-900 mb-2">Admin</h3>
            <p className="text-sm text-gray-500 mb-6">Full access to all system features including user management and billing.</p>
            <ul className="space-y-3 text-sm text-gray-700">
              <li className="flex items-center gap-2">✅ View Dashboard</li>
              <li className="flex items-center gap-2">✅ Edit Pipeline Data</li>
              <li className="flex items-center gap-2">✅ Manage Users</li>
              <li className="flex items-center gap-2">✅ Delete Records</li>
            </ul>
          </div>

          {/* Editor Role */}
          <div className="bg-white rounded-3xl border border-blue-500 p-6 shadow-md relative">
            <div className="absolute top-0 right-0 bg-blue-500 text-white text-xs font-bold px-3 py-1 rounded-bl-xl rounded-tr-2xl">DEFAULT</div>
            <h3 className="text-lg font-bold text-gray-900 mb-2">Editor</h3>
            <p className="text-sm text-gray-500 mb-6">Can edit data and generate reports, but cannot manage users.</p>
            <ul className="space-y-3 text-sm text-gray-700">
              <li className="flex items-center gap-2">✅ View Dashboard</li>
              <li className="flex items-center gap-2">✅ Edit Pipeline Data</li>
              <li className="flex items-center gap-2 text-gray-300">❌ Manage Users</li>
              <li className="flex items-center gap-2 text-gray-300">❌ Delete Records</li>
            </ul>
          </div>

          {/* Viewer Role */}
          <div className="bg-white rounded-3xl border border-gray-100 p-6 shadow-sm">
            <h3 className="text-lg font-bold text-gray-900 mb-2">Viewer</h3>
            <p className="text-sm text-gray-500 mb-6">Read-only access to view dashboards and reports.</p>
            <ul className="space-y-3 text-sm text-gray-700">
              <li className="flex items-center gap-2">✅ View Dashboard</li>
              <li className="flex items-center gap-2 text-gray-300">❌ Edit Pipeline Data</li>
              <li className="flex items-center gap-2 text-gray-300">❌ Manage Users</li>
              <li className="flex items-center gap-2 text-gray-300">❌ Delete Records</li>
            </ul>
          </div>
        </div>
      </div>
    </>
  );
}
