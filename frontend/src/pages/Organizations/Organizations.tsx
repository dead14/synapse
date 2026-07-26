import { useEffect, useState } from 'react';
import { FiBriefcase, FiEdit, FiPlus } from 'react-icons/fi';
import PageMeta from '../../components/common/PageMeta';
import { apiFetch } from '../../utils/api';

interface Organization {
  id: number;
  name: string;
  slug: string;
  created_at: string;
}

export default function Organizations() {
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchOrgs = async () => {
      try {
        const data = await apiFetch<Organization[]>('/api/organizations');
        if (Array.isArray(data)) {
          setOrganizations(data);
        } else {
          setOrganizations([]);
        }
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    fetchOrgs();
  }, []);

  return (
    <>
      <PageMeta title="Organizations | Synapse PIMS" description="Manage organizations and tenants" />
      <div className="p-4 md:p-6 2xl:p-10 bg-[#f8f9fc] min-h-screen">
        
        {/* Header */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-8">
          <div>
            <h2 className="text-2xl font-bold text-gray-900 tracking-tight flex items-center gap-2">
              <div className="w-10 h-10 rounded-xl bg-purple-100 text-purple-600 flex items-center justify-center mr-2">
                <FiBriefcase size={20} />
              </div>
              Organizations / Tenants
            </h2>
            <p className="text-sm text-gray-500 mt-2">Manage the different companies using the system.</p>
          </div>
          <button className="inline-flex items-center justify-center gap-2 px-5 py-3 text-sm font-medium text-white bg-purple-600 rounded-xl hover:bg-purple-700 transition-colors shadow-sm opacity-50 cursor-not-allowed">
            <FiPlus size={18} />
            Add Organization
          </button>
        </div>

        {/* Table Container */}
        <div className="bg-white rounded-3xl border border-gray-100 shadow-[0_8px_30px_rgb(0,0,0,0.04)] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-gray-50/50 border-b border-gray-100">
                  <th className="px-6 py-4 font-semibold text-gray-500 text-xs uppercase tracking-wider">ID</th>
                  <th className="px-6 py-4 font-semibold text-gray-500 text-xs uppercase tracking-wider">Company Name</th>
                  <th className="px-6 py-4 font-semibold text-gray-500 text-xs uppercase tracking-wider">Slug</th>
                  <th className="px-6 py-4 font-semibold text-gray-500 text-xs uppercase tracking-wider">Date Created</th>
                  <th className="px-6 py-4 font-semibold text-gray-500 text-xs uppercase tracking-wider text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {loading ? (
                  <tr>
                    <td colSpan={5} className="px-6 py-8 text-center text-gray-500">Loading organizations...</td>
                  </tr>
                ) : organizations.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-6 py-8 text-center text-gray-500">No organizations found</td>
                  </tr>
                ) : (
                  organizations.map((org) => (
                    <tr key={org.id} className="hover:bg-gray-50/50 transition-colors">
                      <td className="px-6 py-4 text-sm font-medium text-gray-500">#{org.id}</td>
                      <td className="px-6 py-4">
                        <span className="font-semibold text-gray-800">{org.name}</span>
                      </td>
                      <td className="px-6 py-4">
                        <span className="text-sm text-gray-500 font-mono bg-gray-100 px-2 py-1 rounded">{org.slug}</span>
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-500">
                        {new Date(org.created_at).toLocaleDateString()}
                      </td>
                      <td className="px-6 py-4 text-right">
                        <button className="p-2 text-gray-400 hover:text-gray-800 hover:bg-gray-100 rounded-lg transition-colors">
                          <FiEdit size={18} />
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  );
}
