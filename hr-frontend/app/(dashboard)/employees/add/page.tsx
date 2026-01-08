'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import api from '@/lib/api';
import { useAuth } from '@/context/AuthContext';

export default function AddEmployeePage() {
  const router = useRouter();
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [formData, setFormData] = useState({
    // Basic User Info
    first_name: '',
    last_name: '',
    email: '',
    username: '', 
    password: 'Employee123!', 
    
    // HR Specific Info
    employee_code: '',
    department: '', 
    position: '',
    employment_type: 'FULL_TIME',
    work_location: 'ONSITE',
    
    // Personal Info
    dob: '', // <--- NEW FIELD
    phone: '',
    gender: 'M',
    nationality: 'Egyptian',
    national_id: '',
    emergency_contact: '',
  });

  if (user?.role === 'EMPLOYEE') {
    return <div className="p-6 text-red-600">Access Denied</div>;
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const payload = {
        ...formData,
        username: formData.email,
        department: Number(formData.department) 
      };

      await api.post('/employees/', payload);
      router.push('/employees');
      
    } catch (err: any) {
      console.error(err);
      if (err.response?.data) {
        setError(JSON.stringify(err.response.data));
      } else {
        setError('Failed to create employee.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto pb-10">
      <h1 className="text-2xl font-bold mb-6">Add New Employee</h1>
      
      <form onSubmit={handleSubmit} className="bg-white p-8 rounded shadow-md space-y-6">
        {error && <div className="bg-red-100 text-red-700 p-3 rounded text-sm font-mono break-all">{error}</div>}

        {/* SECTION 1: Account Info */}
        <h3 className="text-lg font-bold border-b pb-2 text-gray-800">Account Information</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label className="label">First Name</label>
            <input name="first_name" required onChange={handleChange} className="input-field" />
          </div>
          <div>
            <label className="label">Last Name</label>
            <input name="last_name" required onChange={handleChange} className="input-field" />
          </div>
          <div className="md:col-span-2">
            <label className="label">Email Address</label>
            <input type="email" name="email" required onChange={handleChange} className="input-field" />
          </div>
        </div>

        {/* SECTION 2: Employment Details */}
        <h3 className="text-lg font-bold border-b pb-2 text-gray-800 mt-6">Employment Details</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label className="label">Employee Code</label>
            <input name="employee_code" placeholder="e.g. EMP-005" required onChange={handleChange} className="input-field" />
          </div>
          
          <div>
            <label className="label">Department</label>
            <select name="department" required onChange={handleChange} className="input-field bg-white">
              <option value="">Select Department...</option>
              {/* UPDATE THESE IDs BASED ON YOUR DATABASE */}
              <option value="1">IT / Engineering (ID: 1)</option>
              <option value="2">Human Resources (ID: 2)</option>
              <option value="3">Sales (ID: 3)</option>
              <option value="4">Marketing (ID: 4)</option>
            </select>
          </div>

          <div>
            <label className="label">Position</label>
            <input name="position" required onChange={handleChange} className="input-field" />
          </div>

          <div>
            <label className="label">Employment Type</label>
            <select name="employment_type" required onChange={handleChange} className="input-field bg-white">
              <option value="FULL_TIME">Full Time</option>
              <option value="PART_TIME">Part Time</option>
              <option value="CONTRACT">Contract</option>
            </select>
          </div>

           <div>
            <label className="label">Work Location</label>
            <select name="work_location" required onChange={handleChange} className="input-field bg-white">
              <option value="ONSITE">On-site</option>
              <option value="REMOTE">Remote</option>
              <option value="HYBRID">Hybrid</option>
            </select>
          </div>
        </div>

        {/* SECTION 3: Personal Details */}
        <h3 className="text-lg font-bold border-b pb-2 text-gray-800 mt-6">Personal Details</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label className="label">Date of Birth</label>
            <input 
              type="date" 
              name="dob" 
              required 
              onChange={handleChange} 
              className="input-field" 
            />
          </div>
          <div>
            <label className="label">Phone Number</label>
            <input name="phone" required onChange={handleChange} className="input-field" />
          </div>
          <div>
             <label className="label">Emergency Contact</label>
             <input name="emergency_contact" required onChange={handleChange} className="input-field" />
          </div>
          <div>
             <label className="label">National ID</label>
             <input name="national_id" required onChange={handleChange} className="input-field" />
          </div>
          <div>
             <label className="label">Nationality</label>
             <input name="nationality" defaultValue="Egyptian" required onChange={handleChange} className="input-field" />
          </div>
          <div>
             <label className="label">Gender</label>
             <select name="gender" required onChange={handleChange} className="input-field bg-white">
               <option value="M">Male</option>
               <option value="F">Female</option>
             </select>
          </div>
        </div>

        {/* Form Actions */}
        <div className="flex justify-end space-x-4 pt-6 border-t mt-6">
          <button 
            type="button"
            onClick={() => router.back()}
            className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded"
          >
            Cancel
          </button>
          <button 
            type="submit" 
            disabled={loading}
            className="px-6 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-blue-300 transition shadow-lg"
          >
            {loading ? 'Saving...' : 'Create Employee'}
          </button>
        </div>
      </form>

      <style jsx>{`
        .label { display: block; font-size: 0.875rem; font-weight: 500; color: #374151; margin-bottom: 0.25rem; }
        .input-field { width: 100%; border: 1px solid #d1d5db; padding: 0.5rem; border-radius: 0.375rem; outline: none; transition: box-shadow 0.2s; }
        .input-field:focus { box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.3); border-color: #3b82f6; }
      `}</style>
    </div>
  );
}