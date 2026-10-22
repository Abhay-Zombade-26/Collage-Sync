import React, { useState, useEffect } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { apiClient } from "../api/client";
import { clearAccessToken, setAccessToken } from "../api/authStore";
import { LoadingSpinner } from "./ui/LoadingSpinner";
interface AuthGuardProps {
  children: React.ReactNode;
}

/**
 * Session gate for the authenticated part of the app.
 *
 * The backend does not expose a `GET /auth/me` endpoint; the session is
 * proven by the httpOnly refresh cookie, which only `POST /auth/refresh`
 * can read. The guard therefore calls that endpoint on mount:
 *   - 200 -> a fresh access token is issued and stored; render the app.
 *   - 401 -> no valid session; redirect to /login.
 *
 * Initial state is 'checking' (not false) so the guard does not prematurely
 * redirect before the /auth/refresh response has definitively failed.
 */
export const AuthGuard: React.FC<AuthGuardProps> = ({ children }) => {
  const [status, setStatus] = useState<'checking' | 'authenticated' | 'unauthenticated'>(
    'checking'
  );
  const navigate = useNavigate();

  useEffect(() => {
    let mounted = true;

    const checkSession = async () => {
      try {
        const { data, error } = await apiClient.POST('/api/auth/refresh');
        if (!mounted) {
          return;
        }
        if (error || !data) {
          clearAccessToken();
          setStatus('unauthenticated');
          navigate({ to: '/login' });
          return;
        }
        setAccessToken(data.access_token);
        setStatus('authenticated');
      } catch (_err: unknown) {
        if (mounted) {
          clearAccessToken();
          setStatus('unauthenticated');
          navigate({ to: '/login' });
        }
      }
    };

    checkSession();
    return () => {
      mounted = false;
    };
  }, [navigate]);

  // Only render children when status is explicitly 'authenticated'.
  // 'checking' and 'unauthenticated' both fall through to the redirect/loading UI.
  if (status === 'authenticated') {
    return <>{children}</>;
  }

  return (
    <div className="flex items-center justify-center min-h-screen bg-slate-50">
      <div className="flex items-center gap-2 text-slate-500 text-sm">
        <LoadingSpinner size="md" />
        <span>Checking session...</span>
      </div>
    </div>
  );
};
