import React, { useState, useEffect } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { apiClient } from "../api/client";
import { clearAccessToken, getAccessToken, setAccessToken } from "../api/authStore";
import { LoadingSpinner } from "./ui/LoadingSpinner";
interface AuthGuardProps {
  children: React.ReactNode;
}

/**
 * Session gate for the authenticated part of the app.
 *
 * 1. If a valid access token already exists in authStore, authenticate immediately.
 * 2. If no valid access token exists, attempt silent refresh via /api/auth/refresh.
 * 3. If refresh fails, clear tokens and redirect to /login.
 */
export const AuthGuard: React.FC<AuthGuardProps> = ({ children }) => {
  const [status, setStatus] = useState<'checking' | 'authenticated' | 'unauthenticated'>(() => {
    return getAccessToken() ? 'authenticated' : 'checking';
  });
  const navigate = useNavigate();

  useEffect(() => {
    let mounted = true;

    // If already authenticated with an active valid token, do not clear or force refresh.
    if (getAccessToken()) {
      setStatus('authenticated');
      return;
    }

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
    <div className="flex items-center justify-center min-h-screen bg-background text-slate-400">
      <div className="flex items-center gap-3 text-sm font-medium">
        <LoadingSpinner size="md" />
        <span className="tracking-wide">Checking session...</span>
      </div>
    </div>
  );
};
