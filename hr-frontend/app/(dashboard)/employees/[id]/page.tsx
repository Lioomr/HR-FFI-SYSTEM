'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import api from '@/lib/api';
import { useAuth } from '@/context/AuthContext';

// Updated Interface
interface EmployeeDetail {
  id: number;
  first_name: string;
  last_name: string;
  email: string;
  department: any; // Using any temporarily if backend sends ID or Object
  position: string;
  date_joined: string;
  is_active: boolean;
  employee_code: string;
  phone: string;
  dob: string;
  gender: string;
  nationality: string;
  national_id: string;
  emergency_contact: string;
  employment_type: string;
  work_location: string;
}

export default function EmployeeDetailsPage() {
  const params = useParams();
  const router = useRouter();
  const { user } = useAuth();
  
  const [employee, setEmployee] = useState<EmployeeDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const id = params?.id; 

  useEffect(() => {
    if (!id) return;
    api.get(`/employees/${id}/`)
      .then(res => setEmployee(res.data))
      .catch(err => {
        console.error(err);
        setError('Could not load employee details.');
      })
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <div className="p-8">Loading details...</div>;
  if (error) return <div className="p-8 text-red-500 font-bold">{error}</div>;
  if (!employee) return <div className="p-8">Employee not found</div>;

  return (
    <div className="max-w-5xl mx-auto pb-10">
      {/* Header Actions */}
      <div className="flex items-center justify-between mb-6">
        <button 
          onClick={() => router.back()} 
          className="text-gray-600 hover:text-gray-900 flex items-center gap-2"
        >
          ← Back to List
        </button>
        
        {user?.role === 'ADMIN' && (
          <button className="bg-red-50 text-red-600 px-4 py-2 rounded border border-red-200 hover:bg-red-100 transition text-sm font-medium">
            Delete Employee
          </button>
        )}
      </div>

      {/* Main Card */}
      <div className="bg-white shadow-xl rounded-xl overflow-hidden border border-gray-100">
        
        {/* Banner */}
        <div className="bg-slate-900 p-8 text-white flex justify-between items-start">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">
              {employee.first_name} {employee.last_name}
            </h1>
            <p className="text-blue-300 font-medium mt-1 text-lg">{employee.position}</p>
            <div className="mt-4 flex gap-3">
              <span className={`px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wide ${
                employee.is_active ? 'bg-green-500 text-white' : 'bg-red-500 text-white'
              }`}>
                {employee.is_active ? 'Active' : 'Inactive'}
              </span>
              <span className="bg-slate-700 text-slate-200 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wide">
                {employee.employment_type?.replace('_', ' ')}
              </span>
            </div>
          </div>
          <div className="text-right opacity-80">
            <p className="text-sm">Employee ID</p>
            <p className="font-mono text-xl">{employee.employee_code}</p>
          </div>
        </div>

        {/* Details Grid */}
        <div className="p-8 grid grid-cols-1 lg:grid-cols-2 gap-10">
          
          {/* LEFT COLUMN: Employment Info */}
          <div>
            <h3 className="text-lg font-bold text-gray-800 border-b pb-2 mb-4">Employment Information</h3>
            <div className="space-y-4">
              <DetailRow label="Department" value={employee.department} />
              <DetailRow label="Work Location" value={employee.work_location} />
              <DetailRow label="Date Joined" value={new Date(employee.date_joined).toLocaleDateString()} />
              <DetailRow label="Email (System)" value={employee.email} />
            </div>
          </div>

          {/* RIGHT COLUMN: Personal Info */}
          <div>
            <h3 className="text-lg font-bold text-gray-800 border-b pb-2 mb-4">Personal Information</h3>
            <div className="space-y-4">
              <DetailRow label="Phone Number" value={employee.phone} />
              <DetailRow label="Date of Birth" value={employee.dob} />
              <DetailRow label="Gender" value={employee.gender === 'M' ? 'Male' : 'Female'} />
              <DetailRow label="Nationality" value={employee.nationality} />
              <DetailRow label="National ID" value={employee.national_id} />
            </div>
          </div>
          
          {/* FULL WIDTH: Emergency */}
          <div className="lg:col-span-2">
            <h3 className="text-lg font-bold text-gray-800 border-b pb-2 mb-4">Emergency Contact</h3>
            <div className="bg-red-50 p-4 rounded-lg border border-red-100">
               <span className="text-red-800 font-medium text-lg">{employee.emergency_contact}</span>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}

// Helper Component for cleaner code
function DetailRow({ label, value }: { label: string, value: any }) {
  return (
    <div className="grid grid-cols-3 border-b border-gray-50 pb-2 last:border-0">
      <span className="text-sm font-semibold text-gray-500 uppercase tracking-wider">{label}</span>
      <span className="col-span-2 text-gray-900 font-medium">{value || '-'}</span>
    </div>
  );
}