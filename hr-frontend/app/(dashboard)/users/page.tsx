'use client';

import { useEffect, useState } from 'react';
import api from '@/lib/api';
import { useAuth } from '@/context/AuthContext';

interface UserData {
  id: string; 
  email: string;
  role: 'ADMIN' | 'HR' | 'EMPLOYEE';
  is_active: boolean;
}

export default function UserManagementPage() {
  const { user } = useAuth();
  const [users, setUsers] = useState<UserData[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Modals State
  const [isCreating, setIsCreating] = useState(false);
  const [createdUserCredentials, setCreatedUserCredentials] = useState<{email: string, password: string} | null>(null);

  const [newUser, setNewUser] = useState({
    email: '',
    role: 'EMPLOYEE',
    is_active: true
    // Note: We don't send 'password' anymore, the backend generates it
  });

  // Fetch Users
  const fetchUsers = async () => {
    try {
      const res = await api.get('/admin/users/');
      setUsers(res.data);
    } catch (err) {
      console.error("Failed to fetch users", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  // Handle Create User
  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      // 1. Send Request
      const res = await api.post('/admin/users/', newUser);
      
      // 2. Capture the TEMPORARY PASSWORD from response
      // The backend returns { email: "...", password: "temp-pass", ... }
      const tempPassword = res.data.password || res.data.temporary_password;

      // 3. Show Success Modal with Credentials
      setCreatedUserCredentials({
        email: newUser.email,
        password: tempPassword
      });

      // 4. Reset Form & Refresh List
      setIsCreating(false);
      setNewUser({ email: '', role: 'EMPLOYEE', is_active: true });
      fetchUsers(); 
      
    } catch (err: any) {
      alert("Error: " + JSON.stringify(err.response?.data || err.message));
    }
  };

  const handleDeactivate = async (userId: string) => {
    if (!confirm("Are you sure? This user will no longer be able to log in.")) return;
    try {
      await api.post(`/admin/users/${userId}/deactivate/`);
      fetchUsers();
    } catch (err) {
      alert("Failed to deactivate user.");
    }
  };

  if (user?.role !== 'ADMIN') return <div className="p-8 text-red-600">Access Denied: Admins Only.</div>;

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">System Users</h1>
          <p className="text-gray-500 text-sm">Manage login access and roles</p>
        </div>
        <button 
          onClick={() => setIsCreating(true)}
          className="bg-blue-900 text-white px-4 py-2 rounded hover:bg-blue-800 transition shadow"
        >
          + Create User
        </button>
      </div>

      {/* --- USERS TABLE --- */}
      <div className="bg-white rounded-lg shadow overflow-hidden border border-gray-200">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-slate-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-bold text-gray-500 uppercase">Email / Username</th>
              <th className="px-6 py-3 text-left text-xs font-bold text-gray-500 uppercase">Role</th>
              <th className="px-6 py-3 text-left text-xs font-bold text-gray-500 uppercase">Status</th>
              <th className="px-6 py-3 text-right text-xs font-bold text-gray-500 uppercase">Actions</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {loading ? (
               <tr><td colSpan={4} className="p-6 text-center">Loading...</td></tr>
            ) : users.map((u) => (
              <tr key={u.id} className="hover:bg-gray-50">
                <td className="px-6 py-4 whitespace-nowrap font-medium text-gray-900">{u.email}</td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <span className={`px-2 py-1 text-xs font-bold rounded-full ${
                    u.role === 'ADMIN' ? 'bg-purple-100 text-purple-800' :
                    u.role === 'HR' ? 'bg-blue-100 text-blue-800' :
                    'bg-gray-100 text-gray-800'
                  }`}>
                    {u.role}
                  </span>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  {u.is_active ? (
                    <span className="text-green-600 font-bold text-xs uppercase">Active</span>
                  ) : (
                    <span className="text-red-500 font-bold text-xs uppercase">Deactivated</span>
                  )}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-right text-sm">
                  {u.is_active && (
                    <button 
                      onClick={() => handleDeactivate(u.id)}
                      className="text-red-600 hover:text-red-900 font-medium hover:underline"
                    >
                      Deactivate
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* --- MODAL 1: CREATE USER FORM --- */}
      {isCreating && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white p-6 rounded-lg shadow-xl w-96">
            <h2 className="text-xl font-bold mb-4">Create New User</h2>
            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700">Email</label>
                <input 
                  type="email" 
                  required
                  value={newUser.email}
                  onChange={e => setNewUser({...newUser, email: e.target.value})}
                  className="w-full border p-2 rounded mt-1"
                />
              </div>
              
              {/* Note: Password field removed because Backend generates it now */}
              
              <div>
                <label className="block text-sm font-medium text-gray-700">Role</label>
                <select 
                  value={newUser.role}
                  onChange={e => setNewUser({...newUser, role: e.target.value as any})}
                  className="w-full border p-2 rounded mt-1 bg-white"
                >
                  <option value="EMPLOYEE">Employee</option>
                  <option value="HR">HR Manager</option>
                  <option value="ADMIN">System Admin</option>
                </select>
              </div>

              <div className="flex justify-end gap-2 mt-6">
                <button 
                  type="button" 
                  onClick={() => setIsCreating(false)}
                  className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded"
                >
                  Cancel
                </button>
                <button 
                  type="submit" 
                  className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
                >
                  Create & Generate Password
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* --- MODAL 2: SUCCESS / ONE-TIME CREDENTIALS --- */}
      {createdUserCredentials && (
        <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-[60]">
          <div className="bg-white p-8 rounded-xl shadow-2xl w-[480px] text-center border-4 border-green-100">
            <div className="mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-green-100 mb-4">
              <svg className="h-6 w-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            
            <h3 className="text-2xl font-bold text-gray-900 mb-2">User Created Successfully!</h3>
            <p className="text-sm text-gray-500 mb-6">
              The system has generated a temporary password. 
              <br/>Please copy this now as it will <strong>not be shown again</strong>.
            </p>

            <div className="bg-slate-50 p-4 rounded-lg border border-slate-200 text-left mb-6">
              <div className="mb-3">
                <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">Email</span>
                <div className="font-mono text-gray-900 font-medium select-all">{createdUserCredentials.email}</div>
              </div>
              <div>
                <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">Temporary Password</span>
                <div className="flex justify-between items-center bg-white border p-2 rounded mt-1">
                  <code className="font-mono text-lg font-bold text-blue-600 select-all">
                    {createdUserCredentials.password}
                  </code>
                  <button 
                    onClick={() => navigator.clipboard.writeText(createdUserCredentials.password)}
                    className="text-xs text-gray-500 hover:text-blue-600 font-medium px-2"
                  >
                    Copy
                  </button>
                </div>
              </div>
            </div>

            <button 
              onClick={() => setCreatedUserCredentials(null)}
              className="w-full bg-blue-600 text-white py-3 rounded-lg font-bold hover:bg-blue-700 transition"
            >
              I have saved these details
            </button>
          </div>
        </div>
      )}

    </div>
  );
}