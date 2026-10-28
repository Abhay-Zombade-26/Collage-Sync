import React, { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { APP_ROUTES } from '../../routes';
import { apiClient } from '../../api/client';
import { clearAccessToken } from '../../api/authStore';

interface SidebarProps {
  currentPath: string;
  onNavigate: (path: string) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ currentPath, onNavigate }) => {
  const [isLoggingOut, setIsLoggingOut] = useState<boolean>(false);
  const navigate = useNavigate();

  const handleLogout = async () => {
    setIsLoggingOut(true);
    try {
      // The refresh cookie is httpOnly, so the browser sends it and the
      // backend revokes it and clears the cookie.
      await apiClient.POST('/api/auth/logout');
    } catch (_err: unknown) {
      // Logout is best-effort: the local session is cleared regardless.
    } finally {
      clearAccessToken();
      setIsLoggingOut(false);
      navigate({ to: '/login' });
    }
  };

  return (
    <aside className="w-64 bg-slate-900 border-r border-slate-800 flex flex-col shrink-0 select-none">
      {/* College / Portal Header */}
      <div className="h-16 px-4 flex items-center gap-3 border-b border-slate-800 bg-slate-950/40">
        <div className="w-9 h-9 rounded-md bg-white p-1 flex items-center justify-center shrink-0 shadow-sm transition-transform duration-200 hover:scale-105">
          <img src="/logo.png" alt="DMCE Logo" className="w-full h-full object-contain" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-display font-bold text-sm text-white truncate leading-tight">
            DMCE College ERP
          </p>
          <p className="text-[11px] font-mono text-slate-400 truncate mt-0.5">
            Dept: Info Technology
          </p>
        </div>
      </div>

      {/* Navigation Sections */}
      <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-4">
        {APP_ROUTES.map((section) => (
          <div key={section.title}>
            <div className="px-2.5 mb-1.5 text-[10px] font-semibold text-slate-400 uppercase tracking-widest">
              {section.title}
            </div>
            <ul className="space-y-0.5">
              {section.items.map((item) => {
                const isActive = currentPath === item.path;
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => onNavigate(item.path)}
                      className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded text-xs transition-all duration-150 text-left cursor-pointer ${
                        isActive
                          ? 'bg-accent text-white font-medium shadow-sm'
                          : 'text-slate-300 hover:bg-slate-800 hover:text-white hover:translate-x-0.5'
                      }`}
                    >
                      <span className="truncate">{item.label}</span>
                      {item.status === 'placeholder' && (
                        <span
                          className={`text-[9px] uppercase px-1 py-0.2 rounded-[2px] font-mono shrink-0 ${
                            isActive ? 'bg-white/20 text-white' : 'text-slate-400 bg-slate-800/80'
                          }`}
                        >
                          Queued
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      {/* Session Footer */}
      <div className="p-3 border-t border-slate-800 bg-slate-950/20 text-[11px] text-slate-400">
        <button
          type="button"
          onClick={handleLogout}
          disabled={isLoggingOut}
          className="w-full flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-medium text-slate-300 border border-slate-700 hover:bg-slate-800 hover:text-white hover:border-slate-600 hover:-translate-y-[1px] active:translate-y-0 active:scale-95 transition-all duration-150 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
        >
          <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
            <path
              fillRule="evenodd"
              d="M3 4.5A1.5 1.5 0 014.5 3h4A1.5 1.5 0 0110 4.5v1a1 1 0 11-2 0v-1h-3.5v13h3.5v-1a1 1 0 112 0v1A1.5 1.5 0 018.5 19h-4A1.5 1.5 0 013 17.5v-13zm11.5 2.79a1 1 0 011.06-.13l2.5 1A1 1 0 0118.5 9v2a1 1 0 01-.44.84l-2.5 1a1 1 0 11-.94-1.79L16 10.43V9.57l-1.44-.57a1 1 0 01-.06-1.71z"
              clipRule="evenodd"
            />
          </svg>
          {isLoggingOut ? 'Signing out...' : 'Log Out'}
        </button>
      </div>
    </aside>
  );
};
