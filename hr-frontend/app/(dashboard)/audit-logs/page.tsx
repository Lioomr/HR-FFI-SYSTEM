'use client';

import { useEffect, useState } from 'react';
import api from '@/lib/api';
import { useAuth } from '@/context/AuthContext';

interface AuditLog {
  id: number;
  action: string;      // e.g., "USER_LOGIN", "CREATE_EMPLOYEE"
  actor_email: string; // Who did it
  target: string;      // What was affected (e.g., "John Doe")
  timestamp: string;   // ISO Date
  ip_address?: string;
}

export default function AuditLogsPage() {
  const { user } = useAuth();
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/admin/audit-logs/')
      .then(res => setLogs(res.data))
      .catch(err => console.error("Failed to load logs", err))
      .finally(() => setLoading(false));
  }, []);

  if (user?.role !== 'ADMIN') return <div className="p-8 text-red-600">Access Denied.</div>;

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-800 mb-6">System Audit Logs</h1>

      <div className="bg-white rounded-lg shadow overflow-hidden border border-gray-200">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-slate-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-bold text-gray-500 uppercase">Timestamp</th>
              <th className="px-6 py-3 text-left text-xs font-bold text-gray-500 uppercase">Actor</th>
              <th className="px-6 py-3 text-left text-xs font-bold text-gray-500 uppercase">Action</th>
              <th className="px-6 py-3 text-left text-xs font-bold text-gray-500 uppercase">Target / Details</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {loading ? (
              <tr><td colSpan={4} className="p-6 text-center">Loading history...</td></tr>
            ) : logs.length === 0 ? (
              <tr><td colSpan={4} className="p-6 text-center text-gray-500">No logs found.</td></tr>
            ) : logs.map((log) => (
              <tr key={log.id} className="hover:bg-gray-50 text-sm">
                <td className="px-6 py-4 whitespace-nowrap text-gray-500">
                  {new Date(log.timestamp).toLocaleString()}
                </td>
                <td className="px-6 py-4 whitespace-nowrap font-medium text-blue-900">
                  {log.actor_email}
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <span className={`px-2 py-1 rounded-full text-xs font-bold border ${
                    log.action.includes('DELETE') ? 'bg-red-50 text-red-700 border-red-200' :
                    log.action.includes('CREATE') ? 'bg-green-50 text-green-700 border-green-200' :
                    'bg-gray-50 text-gray-700 border-gray-200'
                  }`}>
                    {log.action}
                  </span>
                </td>
                <td className="px-6 py-4 text-gray-700">
                  {log.target} <span className="text-xs text-gray-400 ml-2">{log.ip_address}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}