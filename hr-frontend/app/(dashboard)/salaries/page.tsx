'use client';

import { useEffect, useState } from 'react';
import api from '@/lib/api';
import { useAuth } from '@/context/AuthContext';

// --- TYPES ---
interface BasicEmployee {
  id: string; // UUID
  first_name: string;
  last_name: string;
  employee_code: string;
}

interface Salary {
  id: number;
  employee: string; // UUID
  basic_salary: number;
  allowances: number;
  deductions: number;
  net_salary: number;
  effective_from: string;
}

export default function SalariesPage() {
  const { user } = useAuth();
  const [salaries, setSalaries] = useState<Salary[]>([]);
  const [employees, setEmployees] = useState<BasicEmployee[]>([]);
  const [loading, setLoading] = useState(true);

  // Form Visibility
  const [isAdding, setIsAdding] = useState(false);

  // Form State (Matches new Backend Rules)
  const [formData, setFormData] = useState({
    employee: '',       // Will store UUID
    basic_salary: '',
    allowances: '0',
    deductions: '0',
    effective_from: new Date().toISOString().split('T')[0] // Today
  });

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [salariesRes, employeesRes] = await Promise.all([
          api.get('/salaries/'),
          api.get('/employees/')
        ]);
        setSalaries(salariesRes.data);
        setEmployees(employeesRes.data);
      } catch (err) {
        console.error("Failed to load data", err);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  // Helper: Find Employee Name by UUID
  const getEmployeeName = (uuid: string) => {
    const emp = employees.find(e => e.id === uuid);
    return emp ? `${emp.first_name} ${emp.last_name}` : `Unknown (${uuid.substring(0,8)}...)`;
  };

  const handleCreateSalary = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      // 1. Prepare Payload strictly according to Backend Rules
      const payload = {
        employee: formData.employee, // UUID
        basic_salary: Number(formData.basic_salary),
        allowances: Number(formData.allowances),
        deductions: Number(formData.deductions),
        effective_from: formData.effective_from
      };
      
      // 2. Send POST
      const res = await api.post('/salaries/', payload);
      
      // 3. Update UI
      setSalaries([res.data, ...salaries]);
      setIsAdding(false);
      setFormData({
        employee: '',
        basic_salary: '',
        allowances: '0',
        deductions: '0',
        effective_from: new Date().toISOString().split('T')[0]
      });
      
    } catch (err: any) {
      console.error(err);
      alert('Failed: ' + JSON.stringify(err.response?.data || 'Unknown Error'));
    }
  };

  if (loading) return <div className="p-8">Loading Payroll...</div>;

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold text-gray-800">Payroll Management</h1>
        <button 
          onClick={() => setIsAdding(!isAdding)}
          className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded transition shadow"
        >
          {isAdding ? 'Cancel' : '+ Issue Salary'}
        </button>
      </div>

      {/* --- CREATE SALARY FORM --- */}
      {isAdding && (
        <div className="bg-white p-6 rounded-lg shadow-lg mb-8 border border-green-100">
          <h3 className="text-lg font-bold mb-4 text-gray-800">Issue New Salary</h3>
          
          <form onSubmit={handleCreateSalary} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            
            {/* 1. Employee (UUID) */}
            <div className="md:col-span-3">
              <label className="block text-sm font-bold text-gray-700 mb-1">Select Employee</label>
              <select 
                value={formData.employee}
                onChange={(e) => setFormData({...formData, employee: e.target.value})}
                required
                className="w-full border p-2 rounded focus:ring-2 focus:ring-green-500"
              >
                <option value="">-- Choose Employee --</option>
                {employees.map(emp => (
                  <option key={emp.id} value={emp.id}>
                    {emp.first_name} {emp.last_name} ({emp.employee_code})
                  </option>
                ))}
              </select>
            </div>

            {/* 2. Basic Salary */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Basic Salary</label>
              <input 
                type="number" 
                value={formData.basic_salary}
                onChange={(e) => setFormData({...formData, basic_salary: e.target.value})}
                required
                placeholder="e.g. 5000"
                className="w-full border p-2 rounded"
              />
            </div>

             {/* 3. Allowances */}
             <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Allowances</label>
              <input 
                type="number" 
                value={formData.allowances}
                onChange={(e) => setFormData({...formData, allowances: e.target.value})}
                className="w-full border p-2 rounded"
              />
            </div>

             {/* 4. Deductions */}
             <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Deductions</label>
              <input 
                type="number" 
                value={formData.deductions}
                onChange={(e) => setFormData({...formData, deductions: e.target.value})}
                className="w-full border p-2 rounded"
              />
            </div>

            {/* 5. Effective Date */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Effective Date</label>
              <input 
                type="date" 
                value={formData.effective_from}
                onChange={(e) => setFormData({...formData, effective_from: e.target.value})}
                required
                className="w-full border p-2 rounded"
              />
            </div>

            {/* Submit */}
            <div className="md:col-span-3 pt-4 flex justify-end">
              <button type="submit" className="bg-blue-600 text-white py-2 px-8 rounded hover:bg-blue-700 font-bold shadow">
                Confirm & Issue
              </button>
            </div>
          </form>
        </div>
      )}

      {/* --- SALARY TABLE --- */}
      <div className="bg-white rounded-lg shadow overflow-hidden border border-gray-200">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-slate-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-bold text-gray-500 uppercase">Employee</th>
              <th className="px-6 py-3 text-left text-xs font-bold text-gray-500 uppercase">Effective Date</th>
              <th className="px-6 py-3 text-left text-xs font-bold text-gray-500 uppercase">Breakdown</th>
              <th className="px-6 py-3 text-left text-xs font-bold text-gray-500 uppercase">Net Salary</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {salaries.map((salary) => (
              <tr key={salary.id} className="hover:bg-gray-50 transition">
                <td className="px-6 py-4 whitespace-nowrap">
                   <div className="font-medium text-gray-900">{getEmployeeName(salary.employee)}</div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-gray-500">
                  {new Date(salary.effective_from).toLocaleDateString()}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                  <div className="text-green-600">Basic: +{salary.basic_salary?.toLocaleString()}</div>
                  <div className="text-blue-600">Allow: +{salary.allowances?.toLocaleString()}</div>
                  <div className="text-red-600">Deduct: -{salary.deductions?.toLocaleString()}</div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                   {/* Backend calculates Net, but we fallback to manual calculation if missing */}
                   <span className="font-mono font-bold text-lg text-slate-800">
                     ${(salary.net_salary || (salary.basic_salary + salary.allowances - salary.deductions)).toLocaleString()}
                   </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        
        {salaries.length === 0 && !loading && (
          <div className="p-10 text-center text-gray-500 bg-gray-50">
            No salary records found.
          </div>
        )}
      </div>
    </div>
  );
}