'use client';

import { useAuth } from '@/context/AuthContext';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { user, logout, isLoading } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  // 1. FORCED PASSWORD CHANGE GUARD
  useEffect(() => {
    if (!isLoading && user?.must_change_password) {
      // If user must change password, restrict them to that page
      if (pathname !== '/change-password') {
        router.push('/change-password');
      }
    }
  }, [user, isLoading, pathname, router]);

  if (isLoading) return <div className="h-screen flex items-center justify-center">Loading system...</div>;

  // 2. "JAIL" VIEW (Sidebar Hidden)
  if (user?.must_change_password) {
    return (
      <div className="min-h-screen bg-gray-100 flex flex-col">
         {/* Minimal Header */}
        <div className="w-full bg-slate-900 text-white px-6 py-4 shadow-md flex justify-between items-center">
           <div className="text-xl font-bold tracking-wide">FFISYS HR</div>
           <button onClick={logout} className="text-sm text-gray-300 hover:text-white hover:underline">
             Sign Out
           </button>
        </div>
        
        {/* Main Content (Forces the Change Password form to display here) */}
        <main className="flex-1 p-4">
          {children} 
        </main>
      </div>
    );
  }

  // 3. NORMAL VIEW (Full Dashboard)
  const isActive = (path: string) => pathname.startsWith(path) ? "bg-gray-700" : "hover:bg-gray-800";

  return (
    <div className="flex h-screen bg-gray-100">
      <aside className="w-64 bg-slate-900 text-white flex flex-col shadow-xl">
        <div className="p-6 text-xl font-bold border-b border-gray-700 tracking-wide">
          FFISYS HR
        </div>
        
        <nav className="flex-1 p-4 space-y-2 overflow-y-auto">
          
          {/* --- HR MODULES (Admin & HR) --- */}
          {(user?.role === 'ADMIN' || user?.role === 'HR') && (
            <>
              <div className="text-xs font-bold text-gray-500 uppercase mt-4 mb-2">HR Management</div>
              <Link href="/dashboard" className={`block p-3 rounded transition ${isActive('/dashboard')}`}>
                📊 Dashboard
              </Link>
              <Link href="/employees" className={`block p-3 rounded transition ${isActive('/employees')}`}>
                👥 Employees
              </Link>
              <Link href="/salaries" className={`block p-3 rounded transition ${isActive('/salaries')}`}>
                💰 Payroll
              </Link>
            </>
          )}

          {/* --- SYSTEM ADMIN MODULES (Admin Only) --- */}
          {user?.role === 'ADMIN' && (
            <>
              <div className="text-xs font-bold text-gray-500 uppercase mt-6 mb-2">System Admin</div>
              <Link href="/users" className={`block p-3 rounded transition ${isActive('/users')}`}>
                🔐 Users & Access
              </Link>
              <Link href="/audit-logs" className={`block p-3 rounded transition ${isActive('/audit-logs')}`}>
                📜 Audit Logs
              </Link>
            </>
          )}

          {/* --- PERSONAL (Everyone) --- */}
          <div className="text-xs font-bold text-gray-500 uppercase mt-6 mb-2">Personal</div>
          <Link href="/profile" className={`block p-3 rounded transition ${isActive('/profile')}`}>
            👤 My Profile
          </Link>
        </nav>

        <div className="p-4 border-t border-gray-700 bg-slate-800">
           <div className="text-xs text-gray-400 mb-2 truncate" title={user?.email}>{user?.email}</div>
           <div className="text-xs font-bold text-blue-400 mb-3 uppercase tracking-wider">{user?.role}</div>
           <button onClick={logout} className="w-full bg-red-600 hover:bg-red-700 text-white py-2 rounded text-sm transition">
             Sign Out
           </button>
        </div>
      </aside>

      <main className="flex-1 overflow-auto p-8">
        {children}
      </main>
    </div>
  );
}