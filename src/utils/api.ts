/**
 * Centralized API client helper for NaviGraph.
 * Connects the frontend (https://navigraphai.vercel.app)
 * with the backend (https://navigraph-api.vercel.app).
 */

export const API_BASE_URL: string = (() => {
  // 1. Explicit Vite environment variable takes highest precedence
  const envUrl = (import.meta as any).env?.VITE_API_URL;
  if (envUrl && typeof envUrl === 'string' && envUrl.trim() !== '') {
    return envUrl.trim().replace(/\/+$/, '');
  }

  // 2. Production Vercel Deployment detection
  if (typeof window !== 'undefined' && window.location.hostname.includes('vercel.app')) {
    // When frontend is running on Vercel (https://navigraphai.vercel.app),
    // automatically direct all backend requests to the production API URL
    return 'https://navigraph-api.vercel.app';
  }

  // 3. Local Development or same-origin fullstack container (port 3000)
  return '';
})();

/**
 * Builds a fully qualified API URL.
 * In development, returns relative path (e.g. '/chat/stream')
 * In production Vercel, returns 'https://navigraph-api.vercel.app/chat/stream'
 */
export function apiUrl(path: string): string {
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  return `${API_BASE_URL}${cleanPath}`;
}
