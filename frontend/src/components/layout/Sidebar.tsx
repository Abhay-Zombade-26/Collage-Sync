import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { APP_ROUTES } from '../../routes';
import { apiClient } from '../../api/client';
import { clearAccessToken } from '../../api/authStore';

interface SidebarProps {
  currentPath: string;
  onNavigate: (path: string) => void;
}

/* ── Route Icon Map ── */
const routeIcons: Record<string, React.ReactNode> = {
  branches: (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 21h16.5M4.5 3h15M5.25 3v18m13.5-18v18M9 6.75h1.5m-1.5 3h1.5m-1.5 3h1.5m3-6H15m-1.5 3H15m-1.5 3H15M9 21v-3.375c0-.621.504-1.125 1.125-1.125h3.75c.621 0 1.125.504 1.125 1.125V21" />
    </svg>
  ),
  divisions: (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 6.878V6a2.25 2.25 0 012.25-2.25h7.5A2.25 2.25 0 0118 6v.878m-12 0c.235-.083.487-.128.75-.128h10.5c.263 0 .515.045.75.128m-12 0A2.25 2.25 0 004.5 9v.878m13.5-3A2.25 2.25 0 0119.5 9v.878m-15-3A2.25 2.25 0 003 9v10.5a2.25 2.25 0 002.25 2.25h13.5A2.25 2.25 0 0021 19.5V9a2.25 2.25 0 00-1.5-2.122" />
    </svg>
  ),
  subjects: (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
    </svg>
  ),
  rooms: (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
      <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 21v-4.875c0-.621.504-1.125 1.125-1.125h5.25c.621 0 1.125.504 1.125 1.125V21m0 0h4.5V3.545M12.75 21h7.5V10.75M2.25 21h1.5m18 0h-18M2.25 9l4.5-1.636M18.75 3l-1.5.545m0 6.205l3 1m1.5.5l-1.5-.5M6.75 7.364V3h-3v18m3-13.636l10.5-3.819" />
    </svg>
  ),
  teachers: (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
    </svg>
  ),
  eligibility: (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
    </svg>
  ),
  timetable: (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
      <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5m-9-6h.008v.008H12v-.008zM12 15h.008v.008H12V15zm0 2.25h.008v.008H12v-.008zM9.75 15h.008v.008H9.75V15zm0 2.25h.008v.008H9.75v-.008zM7.5 15h.008v.008H7.5V15zm0 2.25h.008v.008H7.5v-.008zm6.75-4.5h.008v.008h-.008v-.008zm0 2.25h.008v.008h-.008V15zm0 2.25h.008v.008h-.008v-.008zm2.25-4.5h.008v.008H16.5v-.008zm0 2.25h.008v.008H16.5V15z" />
    </svg>
  ),
  export: (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
    </svg>
  ),
};

export const Sidebar: React.FC<SidebarProps> = ({ currentPath, onNavigate }) => {
  const [isLoggingOut, setIsLoggingOut] = useState<boolean>(false);
  const [isCollapsed, setIsCollapsed] = useState<boolean>(false);
  const navigate = useNavigate();
  const sidebarRef = useRef<HTMLElement>(null);

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

  /* ESC key to sign out */
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape' && !isLoggingOut) {
      handleLogout();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoggingOut]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  const sidebarWidth = isCollapsed ? 'w-[68px]' : 'w-64';

  return (
    <aside
      ref={sidebarRef}
      className={`${sidebarWidth} bg-white flex flex-col shrink-0 select-none transition-all duration-300 ease-out border-r border-slate-200 relative z-20`}
    >
      {/* ── Brand Header ── */}
      <div className="h-16 px-4 flex items-center gap-3 border-b border-slate-200 bg-white transition-colors">
        {/* Brand Mark */}
        <div className="w-9 h-9 rounded-xl bg-blue-600 flex items-center justify-center font-display font-bold text-white text-xs tracking-widest shadow-sm shrink-0">
          MU
        </div>
        {!isCollapsed && (
          <div className="min-w-0 flex-1">
            <p className="font-display font-bold text-sm text-slate-900 truncate leading-tight tracking-tight">
              DMCE Timetable
            </p>
            <p className="text-[11px] text-slate-500 truncate mt-0.5 tracking-normal">
              Dept. of IT
            </p>
          </div>
        )}
        {/* Collapse Toggle */}
        <button
          type="button"
          onClick={() => setIsCollapsed(!isCollapsed)}
          className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-400 hover:text-blue-600 hover:bg-blue-50/60 transition-colors focus-ring"
          aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          title={isCollapsed ? 'Expand' : 'Collapse'}
        >
          <svg className={`w-3.5 h-3.5 transition-transform duration-300 ${isCollapsed ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
          </svg>
        </button>
      </div>

      {/* ── Navigation Sections ── */}
      <nav className="flex-1 overflow-y-auto py-4 px-2.5 space-y-4">
        {APP_ROUTES.map((section) => (
          <div key={section.title}>
            {/* Section Tag */}
            <div className={`flex items-center gap-2 mb-2 ${isCollapsed ? 'justify-center' : 'px-3 mt-4 mb-2'}`}>
              {!isCollapsed && (
                <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider font-display">
                  {section.title}
                </span>
              )}
              <div className="flex-1 h-px bg-slate-100" />
            </div>

            {/* Route Items */}
            <ul className="space-y-1">
              {section.items.map((item) => {
                const isActive = currentPath === item.path;
                const icon = routeIcons[item.id] || (
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" />
                  </svg>
                );

                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => onNavigate(item.path)}
                      title={isCollapsed ? item.label : undefined}
                      className={`group relative w-full flex items-center gap-3 rounded-lg text-sm transition-colors duration-150 focus-ring ${
                        isCollapsed ? 'justify-center px-2 py-2' : 'px-3 py-2'
                      } ${
                        isActive
                          ? 'bg-blue-50 text-blue-700 font-semibold border border-blue-200/60 shadow-xs'
                          : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50 font-medium'
                      }`}
                    >
                      <span className={`shrink-0 transition-colors ${isActive ? 'text-blue-600' : 'text-slate-400 group-hover:text-slate-600'}`}>
                        {icon}
                      </span>
                      {!isCollapsed && (
                        <>
                          <span className="truncate">{item.label}</span>
                          {item.status === 'placeholder' && (
                            <span className="ml-auto text-[10px] uppercase px-1.5 py-0.5 rounded font-medium shrink-0 bg-slate-100 text-slate-500 border border-slate-200">
                              Soon
                            </span>
                          )}
                        </>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      {/* ── Session Footer ── */}
      <div className="p-3 border-t border-slate-200 bg-white space-y-2">
        {!isCollapsed && (
          <div className="px-2 py-1 flex items-center justify-between text-[11px] text-slate-400">
            <span className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              Console Active
            </span>
            <span className="font-mono">v2.4</span>
          </div>
        )}
        <button
          type="button"
          onClick={handleLogout}
          disabled={isLoggingOut}
          className={`group w-full flex items-center gap-2 rounded-lg text-xs font-medium text-slate-600 hover:text-rose-600 hover:bg-rose-50 border border-slate-200 transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed focus-ring ${
            isCollapsed ? 'justify-center px-2 py-2.5' : 'justify-center px-3 py-2.5'
          }`}
        >
          <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9" />
          </svg>
          {!isCollapsed && (
            <>
              <span>{isLoggingOut ? 'Signing out…' : 'Sign Out'}</span>
              <kbd className="ml-auto text-[10px] text-slate-400 bg-slate-50 px-1.5 py-0.5 rounded border border-slate-200 font-mono">
                ESC
              </kbd>
            </>
          )}
        </button>
      </div>
    </aside>
  );
};
