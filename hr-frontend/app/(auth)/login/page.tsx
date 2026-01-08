'use client';
import { useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import api from '@/lib/api';

export default function LoginPage() {
  const { login } = useAuth(); // Get login function from context
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
  e.preventDefault();
  try {
    const res = await api.post('/auth/login/', { email, password });
    
    // --- UPDATE THIS SECTION ---
    // Extract both Token AND Role from the response
    const { access, role } = res.data; 
    
    // Pass BOTH to the new login function
    login(access, role); 
    // ---------------------------

  } catch (err) {
    setError('Invalid credentials');
  }
};

  return (
    <div className="flex h-screen items-center justify-center bg-gray-100">
      <form onSubmit={handleSubmit} className="bg-white p-8 rounded shadow-md w-96">
        <h1 className="text-2xl font-bold mb-6 text-center text-gray-800">Login</h1>
        
        {error && (
          <div className="bg-red-100 text-red-600 p-3 mb-4 rounded text-sm">
            {error}
          </div>
        )}
        
        <div className="mb-4">
          <label className="block mb-2 text-sm font-bold text-gray-700">Email</label>
          <input 
            type="email" 
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full border p-2 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900" 
            placeholder="admin@example.com"
            required 
          />
        </div>
        
        <div className="mb-6">
          <label className="block mb-2 text-sm font-bold text-gray-700">Password</label>
          <input 
            type="password" 
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full border p-2 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900" 
            placeholder="********"
            required 
          />
        </div>
        
        <button 
          type="submit" 
          disabled={loading}
          className="w-full bg-blue-600 text-white py-2 rounded hover:bg-blue-700 transition disabled:bg-blue-300"
        >
          {loading ? 'Signing In...' : 'Sign In'}
        </button>
      </form>
    </div>
  );
}