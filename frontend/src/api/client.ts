/**
 * API Client
 * Wired directly to the FastAPI backend via openapi-typescript + openapi-fetch.
 */
import createClient, { type Middleware } from "openapi-fetch";
import type { paths } from "./schema";
import { getAccessToken } from "./authStore";

/**
 * The generated schema's path keys are server-relative and already include
 * the `/api` prefix (e.g. "/api/divisions"). openapi-fetch concatenates
 * `baseUrl + path` verbatim, so the base URL must be the server root.
 *
 * In production this comes from VITE_API_BASE_URL (set in Vercel).
 * Locally it falls back to localhost.
 */
const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";

export const apiClient = createClient<paths>({
  baseUrl: API_BASE_URL,
  credentials: "include", // Required for the refresh token cookie later
});

/**
 * Attach the in-memory RS256 access token to every request.
 *
 * openapi-fetch >= 0.14 removed the `middleware` option from `ClientOptions`;
 * middleware is now registered with `client.use(...)`.
 */
const authMiddleware: Middleware = {
  onRequest({ request }) {
    const token = getAccessToken();
    if (token) {
      request.headers.set("Authorization", `Bearer ${token}`);
    }
    return request;
  },
};

apiClient.use(authMiddleware);