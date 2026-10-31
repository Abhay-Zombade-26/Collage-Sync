/**
 * Access-token store.
 *
 * The backend issues a short-lived RS256 access token in the login response
 * body and a long-lived refresh token as an httpOnly cookie.
 *
 * In cross-site deployments (e.g. Vercel frontend + Render backend) or on
 * page reloads, storing the access token in localStorage preserves the active
 * session and avoids unexpected logouts when third-party cookies are restricted.
 */

const STORAGE_KEY = 'dmce_access_token';

const isTokenExpired = (token: string): boolean => {
  try {
    const parts = token.split('.');
    if (parts.length !== 3 || !parts[1]) return true;
    const payload = JSON.parse(atob(parts[1]));
    if (typeof payload.exp !== 'number') return false;
    // Expired if within 5 seconds of exp timestamp
    return payload.exp * 1000 <= Date.now() + 5000;
  } catch {
    return true;
  }
};

let accessToken: string | null = null;
if (typeof window !== 'undefined') {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored && !isTokenExpired(stored)) {
    accessToken = stored;
  } else if (stored) {
    localStorage.removeItem(STORAGE_KEY);
  }
}

export const getAccessToken = (): string | null => {
  if (accessToken && isTokenExpired(accessToken)) {
    clearAccessToken();
    return null;
  }
  return accessToken;
};

export const setAccessToken = (token: string | null): void => {
  accessToken = token;
  if (typeof window !== 'undefined') {
    if (token) {
      localStorage.setItem(STORAGE_KEY, token);
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  }
};

export const clearAccessToken = (): void => {
  accessToken = null;
  if (typeof window !== 'undefined') {
    localStorage.removeItem(STORAGE_KEY);
  }
};
