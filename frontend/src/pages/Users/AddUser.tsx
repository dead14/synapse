import { useEffect, useState } from 'react';
import { FiArrowLeft, FiCheck, FiUser } from 'react-icons/fi';
import { Link, useNavigate } from 'react-router-dom';
import PageMeta from '../../components/common/PageMeta';

interface Organization {
  id: number;
  name: string;
}

export default function AddUser() {
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const [formData, setFormData] = useState({
    username: '',
    email: '',
    password: '',
    organization_id: '',
    role: 'viewer'
  });

  useEffect(() => {
    const fetchOrgs = async () => {
      try {
        const token = localStorage.getItem('synapse_token');
        const res = await fetch('http://localhost:8000/api/organizations', {
          headers: { Authorization: `Bearer ${token}` }
        });
        const data = await res.json();
        if (Array.isArray(data)) {
          setOrganizations(data);
          if (data.length > 0) {
            setFormData(prev => ({ ...prev, organization_id: data[0].id.toString() }));
          }
        }
      } catch (err) {
        console.error(err);
      }
    };
    fetchOrgs();
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    
    try {
      const token = localStorage.getItem('synapse_token');
      const res = await fetch('http://localhost:8000/api/users', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}` 
        },
        body: JSON.stringify({
          ...formData,
          organization_id: parseInt(formData.organization_id)
        })
      });
      
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || 'Failed to create user');
      }
      
      setSuccess(true);
      setTimeout(() => {
        navigate('/users');
      }, 2000);
      
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <PageMeta title="Add User | Synapse PIMS" description="Register a new system user" />
      <div className="p-4 md:p-6 2xl:p-10 bg-[#f8f9fc] min-h-screen">
        
        <div className="mb-8">
          <Link to="/users" className="inline-flex items-center text-sm font-medium text-gray-500 hover:text-blue-600 transition-colors mb-4">
            <FiArrowLeft className="mr-2" /> Back to User List
          </Link>
          <h2 className="text-2xl font-bold text-gray-900 tracking-tight flex items-center gap-2">
            <div className="w-10 h-10 rounded-xl bg-blue-100 text-blue-600 flex items-center justify-center">
              <FiUser size={20} />
            </div>
            Register New User
          </h2>
        </div>

        <div className="max-w-2xl bg-white rounded-3xl border border-gray-100 shadow-[0_8px_30px_rgb(0,0,0,0.04)] p-8">
          
          {success ? (
            <div className="flex flex-col items-center justify-center py-12 text-center animate-in zoom-in duration-300">
              <div className="w-16 h-16 bg-green-100 text-green-600 rounded-full flex items-center justify-center mb-4">
                <FiCheck size={32} />
              </div>
              <h3 className="text-xl font-bold text-gray-900 mb-2">User Created Successfully!</h3>
              <p className="text-gray-500">Redirecting to user list...</p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-6">
              
              {error && (
                <div className="p-4 text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl">
                  {error}
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Username</label>
                  <input
                    type="text"
                    name="username"
                    value={formData.username}
                    onChange={handleChange}
                    className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-colors"
                    placeholder="e.g. jdoe_chevron"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Email Address</label>
                  <input
                    type="email"
                    name="email"
                    value={formData.email}
                    onChange={handleChange}
                    className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-colors"
                    placeholder="john@example.com"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Password</label>
                <input
                  type="password"
                  name="password"
                  value={formData.password}
                  onChange={handleChange}
                  className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-colors"
                  placeholder="Set an initial password"
                  required
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Organization / Tenant</label>
                  <select
                    name="organization_id"
                    value={formData.organization_id}
                    onChange={handleChange}
                    className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-colors bg-white"
                    required
                  >
                    <option value="" disabled>Select an organization</option>
                    {organizations.map(org => (
                      <option key={org.id} value={org.id}>{org.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Role</label>
                  <select
                    name="role"
                    value={formData.role}
                    onChange={handleChange}
                    className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-colors bg-white"
                  >
                    <option value="viewer">Viewer (Read Only)</option>
                    <option value="editor">Editor (Can edit data)</option>
                    <option value="admin">Admin (Full access)</option>
                  </select>
                </div>
              </div>

              <div className="pt-4 flex justify-end gap-3 border-t border-gray-100">
                <Link 
                  to="/users"
                  className="px-6 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-50 rounded-xl transition-colors"
                >
                  Cancel
                </Link>
                <button 
                  type="submit"
                  disabled={loading}
                  className="px-6 py-2.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-xl transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {loading ? 'Registering...' : 'Register User'}
                </button>
              </div>

            </form>
          )}
        </div>
      </div>
    </>
  );
}
