import React from 'react';
import { APP_ROUTES } from '../../routes';

interface SidebarProps {
  currentPath: string;
  onNavigate: (path: string) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ currentPath, onNavigate }) => {
  return (
    <aside className="w-64 bg-slate-900 border-r border-slate-800 flex flex-col shrink-0 select-none">
      {/* College / Portal Header */}
      <div className="h-16 px-4 flex items-center gap-3 border-b border-slate-800 bg-slate-950/40">
        <div className="w-8 h-8 rounded bg-accent flex items-center justify-center font-display font-bold text-white text-sm tracking-wider">
          MU
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
                      className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded text-xs transition-colors duration-75 text-left ${
                        isActive
                          ? 'bg-accent text-white font-medium shadow-none'
                          : 'text-slate-300 hover:bg-slate-800 hover:text-white'
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

      {/* System Status Footer */}
      <div className="p-3 border-t border-slate-800 bg-slate-950/20 text-[11px] text-slate-400">
        <div className="flex items-center justify-between">
          <span>Backend Link</span>
          <span className="inline-flex items-center gap-1 text-slate-300">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse"></span>
            Disconnected
          </span>
        </div>
      </div>
    </aside>
  );
};
