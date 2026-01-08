'use client';
import { useEffect, useState } from 'react';
import api from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import Link from 'next/link';

// --- TYPES ---
interface EmployeeData {
  id: string; // UUID
  first_name: string;
  last_name: string;
  email: string;
  department: number; // The ID (e.g., 3)
  position: string;
  employee_code: string;
}

interface Department {
  id: number;
  name: string;
}

export default function EmployeesPage() {
  const { user } = useAuth();
  const [employees, setEmployees] = useState<EmployeeData[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const fetchData = async () => {
      try {
        // Fetch Employees AND Departments in parallel
        const [empRes, deptRes] = await Promise.all([
          api.get('/employees/'),
          api.get('/departments/') // <--- FIXED: Updated Endpoint
        ]);

        setEmployees(empRes.data);
        setDepartments(deptRes.data);
      } catch (err) {
        setError('Failed to load data.');
        console.error(err);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  // Helper to get Department Name
  const getDeptName = (id: number) => {
    const dept = departments.find(d => d.id === id);
    return dept ? dept.name : `Dept #${id}`;
  };

  if (loading) return <div className="p-8">Loading employees...</div>;
  if (error) return <div className="p-8 text-red-500">{error}</div>;

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <div>
           <h1 className="text-2xl font-bold text-gray-800">Employees</h1>
           <p className="text-gray-500 text-sm mt-1">Manage your team members</p>
        </div>
        
        {/* RBAC: Only ADMIN and HR can see the Add button */}
        {(user?.role === 'ADMIN' || user?.role === 'HR') && (
          <Link href="/employees/add">
            <button className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded transition shadow-sm flex items-center gap-2">
              <span>+</span> Add Employee
            </button>
          </Link>
        )}
      </div>

      <div className="bg-white rounded-lg shadow overflow-hidden border border-gray-200">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-slate-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">Employee</th>
              <th className="px-6 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">Role</th>
              <th className="px-6 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">Department</th>
              <th className="px-6 py-3 text-right text-xs font-bold text-gray-500 uppercase tracking-wider">Actions</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {employees.map((emp) => (
              <tr key={emp.id} className="hover:bg-gray-50 transition">
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="flex items-center">
                    <div className="h-10 w-10 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-bold">
                      {emp.first_name[0]}{emp.last_name[0]}
                    </div>
                    <div className="ml-4">
                      <div className="text-sm font-medium text-gray-900">{emp.first_name} {emp.last_name}</div>
                      <div className="text-sm text-gray-500">{emp.email}</div>
                    </div>
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">
                  {emp.position}
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <span className="px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full bg-slate-100 text-slate-800 border border-slate-200">
                    {getDeptName(emp.department)}
                  </span>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                  <Link href={`/employees/${emp.id}`} className="text-blue-600 hover:text-blue-900 font-semibold mr-4">
                    View
                  </Link>
                  {user?.role === 'ADMIN' && (
                    <button className="text-red-600 hover:text-red-900 font-semibold">
                      Delete
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        
        {employees.length === 0 && (
          <div className="p-10 text-center text-gray-500">
            No employees found. Click "Add Employee" to start.
          </div>
        )}
      </div>
    </div>
  );
}