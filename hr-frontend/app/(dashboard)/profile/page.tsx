'use client';

import { useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import api from '@/lib/api';

export default function ProfilePage() {
  const { user } = useAuth();
  
  // Password Form State
  const [passwords, setPasswords] = useState({
    new_password: '',
    confirm_password: ''
  });
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState({ type: '', text: '' });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setPasswords({ ...passwords, [e.target.name]: e.target.value });
  };

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage({ type: '', text: '' });

    if (passwords.new_password !== passwords.confirm_password) {
      setMessage({ type: 'error', text: 'Passwords do not match.' });
      return;
    }

    if (passwords.new_password.length < 8) {
      setMessage({ type: 'error', text: 'Password must be at least 8 characters long.' });
      return;
    }

    setLoading(true);
    try {
      await api.post('/admin/auth/change-password/', {
        new_password: passwords.new_password
      });
      setMessage({ type: 'success', text: 'Password updated successfully!' });
      setPasswords({ new_password: '', confirm_password: '' });
    } catch (err: any) {
      setMessage({ type: 'error', text: 'Failed to update password. Please try again.' });
    } finally {
      setLoading(false);
    }
  };

  if (!user) return <div className="p-8">Loading profile...</div>;

  return (
    <div className="max-w-6xl mx-auto">
      <h1 className="text-3xl font-bold text-gray-800 mb-2">My Profile</h1>
      <p className="text-gray-500 mb-8">Manage your account settings and security preferences.</p>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* LEFT COLUMN: User Details Card */}
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            <div className="bg-slate-900 p-6 flex items-center gap-4">
              <div className="h-16 w-16 rounded-full bg-blue-500 flex items-center justify-center text-white text-2xl font-bold border-4 border-white">
                {user.email[0].toUpperCase()}
              </div>
              <div>
                <h2 className="text-xl font-bold text-white">{user.email}</h2>
                <span className="inline-block bg-blue-600 text-xs px-2 py-1 rounded text-blue-100 font-semibold mt-1">
                  {user.role}
                </span>
              </div>
            </div>
            
            <div className="p-6">
              <h3 className="text-lg font-bold text-gray-800 border-b pb-2 mb-4">Account Information</h3>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="text-xs font-bold text-gray-400 uppercase tracking-wider">User ID</label>
                  <p className="text-gray-700 font-mono text-sm mt-1 bg-gray-50 p-2 rounded border border-gray-100">
                    {user.user_id}
                  </p>
                </div>
                <div>
                  <label className="text-xs font-bold text-gray-400 uppercase tracking-wider">Account Status</label>
                  <p className="mt-1">
                    <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-sm font-medium bg-green-100 text-green-700">
                      <span className="h-2 w-2 rounded-full bg-green-500"></span>
                      Active
                    </span>
                  </p>
                </div>
                <div>
                  <label className="text-xs font-bold text-gray-400 uppercase tracking-wider">Role Permissions</label>
                  <p className="text-gray-700 font-medium mt-1">
                    {user.role === 'ADMIN' ? 'Full System Access' : 
                     user.role === 'HR' ? 'Employee & Payroll Management' : 
                     'Standard Access'}
                  </p>
                </div>
                <div>
                  <label className="text-xs font-bold text-gray-400 uppercase tracking-wider">Email Address</label>
                  <p className="text-gray-700 font-medium mt-1">{user.email}</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN: Change Password Form */}
        <div>
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <h3 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
              Security Settings
            </h3>
            
            <form onSubmit={handlePasswordSubmit} className="space-y-4">
              {message.text && (
                <div className={`p-3 rounded text-sm ${
                  message.type === 'success' ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'
                }`}>
                  {message.text}
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">New Password</label>
                <input 
                  type="password" 
                  name="new_password"
                  value={passwords.new_password}
                  onChange={handleChange}
                  className="w-full border border-gray-300 p-2 rounded focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition"
                  placeholder="Min. 8 characters"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Confirm Password</label>
                <input 
                  type="password" 
                  name="confirm_password"
                  value={passwords.confirm_password}
                  onChange={handleChange}
                  className="w-full border border-gray-300 p-2 rounded focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition"
                  placeholder="Re-enter password"
                  required
                />
              </div>

              <button 
                type="submit" 
                disabled={loading}
                className="w-full bg-slate-900 text-white py-2.5 rounded-lg hover:bg-slate-800 transition font-medium disabled:opacity-70 disabled:cursor-not-allowed mt-2"
              >
                {loading ? 'Updating...' : 'Update Password'}
              </button>
            </form>

            <div className="mt-6 pt-6 border-t border-gray-100 text-xs text-gray-500">
              <p>Password requirements:</p>
              <ul className="list-disc pl-4 mt-1 space-y-1">
                <li>Minimum 8 characters long</li>
                <li>Include numbers & symbols recommended</li>
              </ul>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}