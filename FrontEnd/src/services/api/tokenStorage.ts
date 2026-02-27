const TOKEN_KEY = "ffi_hr_token";
const USER_KEY = "ffi_hr_user";

export function getToken(): string | null {
  return sessionStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string) {
  sessionStorage.setItem(TOKEN_KEY, token);
}

// Minimal user shape for storage (versioned)
type StoredUser = {
  v: number;
  id: string;
  email: string;
  role: string;
};

export function getStoredUser(): StoredUser | null {
  const str = sessionStorage.getItem(USER_KEY);
  if (!str) return null;
  try {
    return JSON.parse(str);
  } catch {
    return null;
  }
}

export function setStoredUser(user: { id: string; email: string; role: string }) {
  const stored: StoredUser = {
    v: 1,
    id: user.id,
    email: user.email,
    role: user.role,
  };
  sessionStorage.setItem(USER_KEY, JSON.stringify(stored));
}

export function clearToken() {
  sessionStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(USER_KEY);
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}
