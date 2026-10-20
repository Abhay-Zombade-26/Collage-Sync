/**
 * API Client
 * Wired directly to the FastAPI backend via openapi-typescript + openapi-fetch.
 */
import createClient from "openapi-fetch";
import type { paths } from "./schema";
import { getAccessToken } from "./authStore";

/**
 * The generated schema's path keys are server-relative and already include
 * the `/api` prefix (e.g. "/api/divisions"). openapi-fetch concatenates
 * `baseUrl + path` verbatim, so the base URL must be the server root.
 */
const API_BASE_URL = "http://localhost:8000";

export const apiClient = createClient<paths>({ 
  baseUrl: API_BASE_URL,
  credentials: "include", // Required for the refresh token cookie later
  middleware: [
    {
      // Attach the in-memory RS256 access token to every request.
      onRequest({ request }) {
        const token = getAccessToken();
        if (token) {
          request.headers.set("Authorization", `Bearer ${token}`);
        }
        return request;
      },
    },
  ],
});
