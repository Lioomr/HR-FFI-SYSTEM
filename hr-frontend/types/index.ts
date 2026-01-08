// These match the data your Django Backend sends

export type Role = 'ADMIN' | 'HR' | 'EMPLOYEE';

// The structure of the decoded JWT token
export interface User {
  user_id: number; // or string, depending on your Django User ID type
  email: string;
  role: Role;      // This is crucial for your RBAC
  exp: number;     // Expiration timestamp
}

// The response when we log in
export interface AuthResponse {
  access: string;
  refresh: string;
}

export interface Salary {
  id: number;
  employee: number; // The Employee's ID (e.g., 5)
  amount: number;
  payment_date: string; // "YYYY-MM-DD"
  status: 'PAID' | 'PENDING';
  employee_name?: string; // Optional helper for display
}