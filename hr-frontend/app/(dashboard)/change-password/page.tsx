'use client';

import { useState } from 'react';
import api from '@/lib/api';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';

export default function ForceChangePasswordPage() {
  const router = useRouter();
  const { logout } = useAuth(); 
  const [passwords, setPasswords] = useState({ new_password: '', confirm_password: '' });
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState({ type: '', text: '' });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage({ type: '', text: '' });

    if (passwords.new_password !== passwords.confirm_password) {
      setMessage({ type: 'error', text: 'Passwords do not match.' });
      return;
    }

    if (passwords.new_password.length < 8) {
      setMessage({ type: 'error', text: 'Password must be at least 8 characters.' });
      return;
    }

    setLoading(true);
    try {
      // Backend Endpoint
      await api.post('/admin/auth/change-password/', { new_password: passwords.new_password });
      
      setMessage({ type: 'success', text: 'Password updated successfully!' });
      
      // Force logout after 1.5 seconds so they log in with the new password to clear the flag
      setTimeout(() => {
        alert("Password changed. Please log in with your new password.");
        logout(); 
      }, 1500);

    } catch (err: any) {
      setMessage({ type: 'error', text: 'Failed to update password. Try again.' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-md mx-auto mt-20">
      <div className="bg-red-50 border border-red-200 p-4 rounded-lg mb-6 text-center shadow-sm">
        <h2 className="text-red-800 font-bold text-lg">⚠️ Security Alert</h2>
        <p className="text-red-700 text-sm mt-1">
          You are logging in for the first time. You must change your password to continue.
        </p>
      </div>

      <div className="bg-white p-8 rounded-lg shadow-xl border border-gray-200">
        <h1 className="text-2xl font-bold text-gray-800 mb-6 text-center">Set New Password</h1>
        
        {message.text && (
          <div className={`p-3 rounded mb-4 text-sm font-medium ${
            message.type === 'success' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
          }`}>
            {message.text}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">New Password</label>
            <input 
              type="password" 
              placeholder="Min. 8 characters" 
              className="w-full border p-2 rounded focus:ring-2 focus:ring-blue-500 outline-none" 
              value={passwords.new_password}
              onChange={e => setPasswords({...passwords, new_password: e.target.value})}
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Confirm Password</label>
            <input 
              type="password" 
              placeholder="Retype password" 
              className="w-full border p-2 rounded focus:ring-2 focus:ring-blue-500 outline-none" 
              value={passwords.confirm_password}
              onChange={e => setPasswords({...passwords, confirm_password: e.target.value})}
              required
            />
          </div>
          <button 
            type="submit" 
            disabled={loading} 
            className="w-full bg-slate-900 text-white py-2 rounded font-bold hover:bg-slate-800 transition disabled:opacity-50 mt-2"
          >
            {loading ? 'Updating...' : 'Update Password & Login'}
          </button>
        </form>
      </div>
    </div>
  );
}