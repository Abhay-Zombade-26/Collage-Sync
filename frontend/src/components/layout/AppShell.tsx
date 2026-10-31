import React, { useRef, useEffect } from 'react';
import { Sidebar } from './Sidebar';

interface AppShellProps {
  currentPath: string;
  onNavigate: (path: string) => void;
  children: React.ReactNode;
}

export const AppShell: React.FC<AppShellProps> = ({ currentPath, onNavigate, children }) => {
  const mainRef = useRef<HTMLDivElement>(null);

  /* Track mouse position for subtle surface interactions */
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      document.documentElement.style.setProperty('--mouse-x', `${e.clientX}px`);
      document.documentElement.style.setProperty('--mouse-y', `${e.clientY}px`);
    };
    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, []);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-slate-50 text-slate-800 relative transition-colors duration-200">
      {/* Left Sidebar */}
      <Sidebar currentPath={currentPath} onNavigate={onNavigate} />

      {/* Main Content Area */}
      <main ref={mainRef} className="flex-1 flex flex-col min-w-0 overflow-y-auto relative z-10">
        {/* ── Sticky Top Bar ── */}
        <div className="h-14 border-b border-slate-200 bg-white/95 backdrop-blur-md px-6 flex items-center justify-between shrink-0 sticky top-0 z-30 transition-colors">
          {/* Left: Live Term Badge */}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <span className="font-display font-semibold text-slate-900 tracking-tight">
                Academic Term
              </span>
              <span className="text-slate-400">·</span>
              <div className="flex items-center gap-2 font-medium text-[12px] text-blue-700 bg-blue-50 border border-blue-200 px-2.5 py-1 rounded-lg">
                <span className="relative flex h-2 w-2">
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                </span>
                2026–2027 Odd Sem
              </div>
            </div>
          </div>

          {/* Right: ENV + Profile */}
          <div className="flex items-center gap-3">
            {/* ENV Badge */}
            <span className="text-[10px] font-mono font-medium text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-md tracking-wider">
              DEV
            </span>

            {/* Profile Avatar */}
            <div className="w-8 h-8 rounded-lg bg-white border border-slate-200 flex items-center justify-center text-slate-600 hover:text-slate-900 hover:border-blue-500 transition-colors cursor-pointer shadow-2xs">
              <svg
                className="w-4 h-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth="1.5"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z"
                />
              </svg>
            </div>
          </div>
        </div>

        {/* ── Page Content Viewport ── */}
        <div className="flex-1 p-6 max-w-7xl w-full mx-auto relative z-10">{children}</div>
      </main>
    </div>
  );
};
