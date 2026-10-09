import React, { useState, useCallback, useEffect } from 'react';
import { ToastContext, ToastMessage } from './useToast';

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentToast, setCurrentToast] = useState<ToastMessage | null>(null);

  const hideToast = useCallback(() => {
    setCurrentToast(null);
  }, []);

  const showToast = useCallback((toast: Omit<ToastMessage, 'id'>) => {
    // Single toast per action, never stacked
    const id = Math.random().toString(36).substring(2, 9);
    setCurrentToast({ ...toast, id });
  }, []);

  useEffect(() => {
    if (!currentToast) return;
    const duration = currentToast.duration ?? 4000;
    const timer = setTimeout(() => {
      hideToast();
    }, duration);
    return () => clearTimeout(timer);
  }, [currentToast, hideToast]);

  return (
    <ToastContext.Provider value={{ showToast, hideToast }}>
      {children}
      {currentToast && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-4 right-4 z-50 flex items-start w-80 max-w-[calc(100vw-2rem)] border rounded bg-white p-3.5 transition-all animate-in fade-in slide-in-from-bottom-2 duration-150"
          style={{
            borderColor:
              currentToast.type === 'success'
                ? '#bbf7d0'
                : currentToast.type === 'error'
                  ? '#fecaca'
                  : '#cbd5e1',
          }}
        >
          {/* Status Indicator Bar */}
          <div
            className={`w-1 self-stretch rounded-full mr-3 shrink-0 ${
              currentToast.type === 'success'
                ? 'bg-success'
                : currentToast.type === 'error'
                  ? 'bg-danger'
                  : 'bg-accent'
            }`}
          />
          <div className="flex-1 min-w-0 pr-2">
            <p className="text-sm font-semibold text-slate-900 leading-tight">
              {currentToast.title}
            </p>
            {currentToast.message && (
              <p className="text-xs text-slate-600 mt-1 leading-normal">{currentToast.message}</p>
            )}
          </div>
          <button
            onClick={hideToast}
            className="text-slate-400 hover:text-slate-600 p-0.5 rounded transition-colors"
            aria-label="Dismiss toast"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
              <path
                fillRule="evenodd"
                d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                clipRule="evenodd"
              />
            </svg>
          </button>
        </div>
      )}
    </ToastContext.Provider>
  );
};
