import React, { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useForm } from 'react-hook-form';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { useToast } from '../components/ui/useToast';
import { apiClient } from '../api/client';
import { setAccessToken } from '../api/authStore';
import type { components } from '../api/schema';

type LoginRequest = components['schemas']['LoginRequest'];

interface LoginFormData {
  email: string;
  password: string;
}

/**
 * Extract a human-readable message from an openapi-fetch error payload.
 * The backend returns `{ "detail": ... }` for HTTPException responses and
 * `{ "detail": [{ msg, loc, ... }] }` for request validation errors.
 */
const extractErrorMessage = (error: unknown, fallback: string): string => {
  if (typeof error === 'object' && error !== null && 'detail' in error) {
    const detail = (error as { detail: unknown }).detail;
    if (typeof detail === 'string') {
      return detail;
    }
    if (Array.isArray(detail) && detail.length > 0) {
      const first = detail[0];
      if (first && typeof first.msg === 'string') {
        return first.msg;
      }
    }
    if (typeof detail === 'object' && detail !== null && 'message' in detail) {
      const message = (detail as { message: unknown }).message;
      if (typeof message === 'string') {
        return message;
      }
    }
  }
  return fallback;
};

export const LoginPage: React.FC = () => {
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const navigate = useNavigate();
  const { showToast } = useToast();

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginFormData>({
    defaultValues: {
      email: '',
      password: '',
    },
  });

  const onSubmit = async (data: LoginFormData) => {
    setIsSubmitting(true);
    // The backend takes a JSON body (LoginRequest), not form-encoded data.
    const body: LoginRequest = {
      email: data.email,
      password: data.password,
    };
    try {
      const { data: token, error } = await apiClient.POST('/api/auth/login', {
        body,
      });
      if (error || !token) {
        const message = extractErrorMessage(error, 'Could not sign in.');
        showToast({
          type: 'error',
          title: 'Sign In Failed',
          message,
        });
        return;
      }
      setAccessToken(token.access_token);
      showToast({
        type: 'success',
        title: 'Signed In',
        message: 'Welcome back.',
      });
      window.location.href = '/';
    } catch (_err: unknown) {
      showToast({
        type: 'error',
        title: 'Sign In Failed',
        message: 'Could not sign in.',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-100 px-4">
      <div className="w-full max-w-sm">
        {/* Brand */}
        <div className="flex flex-col items-center mb-6">
          <div className="w-11 h-11 rounded bg-accent flex items-center justify-center font-display font-bold text-white text-lg tracking-wider">
            MU
          </div>
          <h1 className="mt-3 font-display font-bold text-lg text-slate-900">DMCE College ERP</h1>
          <p className="text-xs text-slate-500 mt-0.5">Dept: Info Technology</p>
        </div>

        {/* Card */}
        <div className="bg-surface border border-slate-200 rounded-lg shadow-sm p-6">
          <h2 className="font-display font-bold text-base text-slate-900">Sign In</h2>
          <p className="text-xs text-slate-500 mt-0.5 mb-5">
            Use your staff account to access the timetable console.
          </p>

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div>
              <Input
                label="Email"
                type="email"
                placeholder="you@college.edu"
                autoComplete="username"
                required
                error={errors.email?.message}
                {...register('email', {
                  required: 'Email is required',
                  pattern: {
                    value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
                    message: 'Enter a valid email address',
                  },
                })}
              />
            </div>

            <div>
              <Input
                label="Password"
                type="password"
                placeholder="••••••••"
                autoComplete="current-password"
                required
                error={errors.password?.message}
                {...register('password', { required: 'Password is required' })}
              />
            </div>

            <Button
              type="submit"
              variant="primary"
              size="md"
              className="w-full"
              isLoading={isSubmitting}
            >
              Sign In
            </Button>
          </form>
        </div>

        <p className="mt-4 text-center text-[11px] text-slate-400">
          Accounts are created by the academic administrator.
        </p>
      </div>
    </div>
  );
};
