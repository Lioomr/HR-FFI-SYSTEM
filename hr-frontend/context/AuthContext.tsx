'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Cookies from 'js-cookie';

interface User {
  user_id: string;
  email: string;
  role: 'ADMIN' | 'HR' | 'EMPLOYEE';
  must_change_password?: boolean;
}

interface AuthContextType {
  user: User | null;
  // UPDATE: login now accepts the role explicitly
  login: (token: string, role: string) => void; 
  logout: () => void;
  isLoading: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setLoading] = useState(true);
  const router = useRouter();

  const parseJwt = (token: string) => {
    try {
      return JSON.parse(atob(token.split('.')[1]));
    } catch (e) {
      return null;
    }
  };

  useEffect(() => {
    const token = Cookies.get('access_token');
    const savedRole = Cookies.get('user_role');
    
    if (token) {
      const decoded = parseJwt(token);
      if (decoded) {
        const finalRole = (savedRole || decoded.role || 'EMPLOYEE').toUpperCase();
        
        setUser({
          user_id: decoded.user_id || decoded.sub,
          email: decoded.email,
          role: finalRole as any,
          must_change_password: decoded.must_change_password
        });
      }
    }
    setLoading(false);
  }, []);

  // UPDATE: We now accept 'role' from the API response
  const login = (token: string, role: string) => {
    const cleanRole = role.toUpperCase();

    // 1. Save Token AND Role to Cookies
    Cookies.set('access_token', token);
    Cookies.set('user_role', cleanRole);

    // 2. Set User State immediately
    const decoded = parseJwt(token);
    if (decoded) {
      setUser({
        user_id: decoded.user_id || decoded.sub,
        email: decoded.email,
        role: cleanRole as any, // Use the explicit role
        must_change_password: decoded.must_change_password
      });
    }
    
    router.push('/dashboard');
  };

  const logout = () => {
    Cookies.remove('access_token');
    Cookies.remove('user_role'); // Clean up
    setUser(null);
    router.push('/login');
  };

  return (
    <AuthContext.Provider value={{ user, login, logout, isLoading }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
};