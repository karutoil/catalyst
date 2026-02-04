import axios from 'axios';
import { useAuthStore } from '../../stores/authStore';

const normalizeBaseUrl = (value?: string) => {
  if (!value) return '';
  if (value === '/api') return '';
  return value.replace(/\/api\/?$/, '');
};

const apiClient = axios.create({
  baseURL: normalizeBaseUrl(import.meta.env.VITE_API_URL) || '',
  timeout: 10000, // 10 seconds - fail fast if something is wrong
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
});

apiClient.interceptors.request.use((config) => {
  const token = useAuthStore.getState().token;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      const code = error.response?.data?.code;
      if (code !== 'TWO_FACTOR_REQUIRED') {
        useAuthStore.getState().logout();
      }
    }
    return Promise.reject(error);
  },
);

export default apiClient;
