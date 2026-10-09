import React from 'react';
import { Sidebar } from './Sidebar';
import { ToastProvider } from '../ui/Toast';

interface AppShellProps {
  currentPath: string;
  onNavigate: (path: string) => void;
  children: React.ReactNode;
}

export const AppShell: React.FC<AppShellProps> = ({ currentPath, onNavigate, children }) => {
  return (
    <ToastProvider>
      <div className="flex h-screen w-screen overflow-hidden bg-background text-slate-800">
        {/* Left Sidebar */}
        <Sidebar currentPath={currentPath} onNavigate={onNavigate} />

        {/* Main Content Area */}
        <main className="flex-1 flex flex-col min-w-0 overflow-y-auto">
          {/* Top Bar / Global Status */}
          <div className="h-10 border-b border-slate-200 bg-surface px-6 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <span className="font-semibold text-slate-700">Academic Term:</span>
              <span>2026–2027 Odd Semester</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-mono text-slate-500 bg-slate-100 border border-slate-200 px-1.5 py-0.5 rounded-[3px]">
                ENV: LOCAL DEV
              </span>
            </div>
          </div>

          {/* Page Content Viewport */}
          <div className="flex-1 p-6 max-w-7xl w-full mx-auto">{children}</div>
        </main>
      </div>
    </ToastProvider>
  );
};
