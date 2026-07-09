import { useEffect, useState } from 'react';
import { FiEdit, FiKey, FiTrash2, FiUserPlus, FiX } from 'react-icons/fi';
import { Link } from 'react-router-dom';
import PageMeta from '../../components/common/PageMeta';

interface User {
  id: number;
  username: string;
  email: string;
  role: string;
  is_active: boolean;
  org_name: string;
  created_at: string;
}

export default function UserList() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [resetModalOpen, setResetModalOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [actionSuccess, setActionSuccess] = useState('');

  const fetchUsers = async () => {
    try {
      const token = localStorage.getItem('synapse_token');
      const res = await fetch('http://localhost:8000/api/users', {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (Array.isArray(data)) {
        setUsers(data);
      } else {
        console.error('API returned non-array:', data);
        setUsers([]);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUser) return;
    try {
      const token = localStorage.getItem('synapse_token');
      const res = await fetch(`http://localhost:8000/api/users/${selectedUser.id}/reset-password`, {
        method: 'PUT',
        headers: { 
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}` 
        },
        body: JSON.stringify({ newPassword })
      });
      if (res.ok) {
        setActionSuccess(`Password reset for ${selectedUser.username}`);
        setResetModalOpen(false);
        setNewPassword('');
        setTimeout(() => setActionSuccess(''), 3000);
      }
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <>
      <PageMeta title="User Management | Synapse PIMS" description="Manage system users" />
      <div className="p-4 md:p-6 2xl:p-10 bg-[#f8f9fc] min-h-screen">
        
        {/* Header */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-8">
          <div>
            <h2 className="text-2xl font-bold text-gray-900 tracking-tight">User Management</h2>
            <p className="text-sm text-gray-500 mt-1">Manage system access and roles across organizations.</p>
          </div>
          <Link 
            to="/users/add" 
            className="inline-flex items-center justify-center gap-2 px-5 py-3 text-sm font-medium text-white bg-blue-600 rounded-xl hover:bg-blue-700 transition-colors shadow-sm"
          >
            <FiUserPlus size={18} />
            Register New User
          </Link>
        </div>

        {actionSuccess && (
          <div className="mb-6 p-4 bg-green-50 border border-green-200 text-green-700 rounded-xl">
            {actionSuccess}
          </div>
        )}

        {/* Table Container - Glassmorphism */}
        <div className="bg-white rounded-3xl border border-gray-100 shadow-[0_8px_30px_rgb(0,0,0,0.04)] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-gray-50/50 border-b border-gray-100">
                  <th className="px-6 py-4 font-semibold text-gray-500 text-xs uppercase tracking-wider">User</th>
                  <th className="px-6 py-4 font-semibold text-gray-500 text-xs uppercase tracking-wider">Organization</th>
                  <th className="px-6 py-4 font-semibold text-gray-500 text-xs uppercase tracking-wider">Role</th>
                  <th className="px-6 py-4 font-semibold text-gray-500 text-xs uppercase tracking-wider">Status</th>
                  <th className="px-6 py-4 font-semibold text-gray-500 text-xs uppercase tracking-wider text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {loading ? (
                  <tr>
                    <td colSpan={5} className="px-6 py-8 text-center text-gray-500">Loading users...</td>
                  </tr>
                ) : users.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-6 py-8 text-center text-gray-500">No users found</td>
                  </tr>
                ) : (
                  users.map((user) => (
                    <tr key={user.id} className="hover:bg-gray-50/50 transition-colors">
                      <td className="px-6 py-4">
                        <div className="flex flex-col">
                          <span className="font-semibold text-gray-800">{user.username}</span>
                          <span className="text-sm text-gray-500">{user.email}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-purple-50 text-purple-700 border border-purple-100">
                          {user.org_name}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <span className="text-sm text-gray-600 capitalize">{user.role}</span>
                      </td>
                      <td className="px-6 py-4">
                        <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium border ${user.is_active ? 'bg-green-50 text-green-700 border-green-100' : 'bg-red-50 text-red-700 border-red-100'}`}>
                          {user.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button 
                            onClick={() => { setSelectedUser(user); setResetModalOpen(true); }}
                            className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors tooltip-trigger relative group"
                          >
                            <FiKey size={18} />
                            <span className="absolute -top-8 left-1/2 -translate-x-1/2 bg-gray-900 text-white text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">Reset Password</span>
                          </button>
                          <button className="p-2 text-gray-400 hover:text-gray-800 hover:bg-gray-100 rounded-lg transition-colors group relative">
                            <FiEdit size={18} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Reset Password Modal */}
      {resetModalOpen && selectedUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gray-900/40 backdrop-blur-sm">
          <div className="bg-white rounded-3xl shadow-xl w-full max-w-md overflow-hidden relative animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between p-6 border-b border-gray-100">
              <h3 className="text-lg font-bold text-gray-900">Reset Password</h3>
              <button onClick={() => setResetModalOpen(false)} className="text-gray-400 hover:text-gray-700 transition-colors">
                <FiX size={24} />
              </button>
            </div>
            <form onSubmit={handleResetPassword} className="p-6">
              <p className="text-sm text-gray-500 mb-6">
                Enter a new password for <span className="font-semibold text-gray-800">{selectedUser.email}</span>.
              </p>
              <div className="mb-6">
                <label className="block text-sm font-medium text-gray-700 mb-2">New Password</label>
                <input 
                  type="password" 
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-colors"
                  placeholder="Enter new password"
                  required
                />
              </div>
              <div className="flex justify-end gap-3">
                <button 
                  type="button" 
                  onClick={() => setResetModalOpen(false)}
                  className="px-5 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-50 rounded-xl transition-colors"
                >
                  Cancel
                </button>
                <button 
                  type="submit"
                  className="px-5 py-2.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-xl transition-colors shadow-sm"
                >
                  Save Password
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
