import axios from 'axios';
import Cookies from 'js-cookie';

// 1. Create the Axios instance
const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// 2. Request Interceptor
// Before sending a request, check if we have a token and attach it.
api.interceptors.request.use((config) => {
  const token = Cookies.get('access_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// 3. Response Interceptor
// If the backend says "401 Unauthorized", it means our token is bad.
// We should log the user out immediately.
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response && error.response.status === 401) {
      // Token expired or invalid
      Cookies.remove('access_token');
      Cookies.remove('refresh_token');
      // Optional: Redirect to login if we are in the browser
      if (typeof window !== 'undefined') {
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  }
);

export default api;