/**
 * Access-token store.
 *
 * The backend issues a short-lived RS256 access token in the login response
 * body and a long-lived refresh token as an httpOnly cookie. The httpOnly
 * cookie cannot be read by JavaScript, so the access token is the only
 * credential the SPA can hold and attach to requests itself.
 *
 * The token is kept in memory (module state) rather than localStorage: a
 * page reload drops it, and the AuthGuard then silently calls /auth/refresh
 * to mint a new one from the still-valid httpOnly refresh cookie.
 */

let accessToken: string | null = null;

export const getAccessToken = (): string | null => accessToken;

export const setAccessToken = (token: string | null): void => {
  accessToken = token;
};

export const clearAccessToken = (): void => {
  accessToken = null;
};
