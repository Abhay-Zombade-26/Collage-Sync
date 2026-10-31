import React from 'react';

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
  helperText?: string;
  required?: boolean;
}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ label, error, helperText, required, id, className = '', ...props }, ref) => {
    const textareaId = id || (label ? label.toLowerCase().replace(/\s+/g, '-') : undefined);

    return (
      <div className="w-full">
        {label && (
          <label
            htmlFor={textareaId}
            className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2 font-display"
          >
            {label}
            {required && <span className="text-rose-400 ml-0.5">*</span>}
          </label>
        )}
        <textarea
          ref={ref}
          id={textareaId}
          aria-invalid={Boolean(error)}
          className={`w-full p-3.5 text-sm bg-slate-800/50 border text-slate-200 placeholder:text-slate-500 rounded-lg transition-all focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500/60 disabled:bg-slate-900/50 disabled:text-slate-500 disabled:cursor-not-allowed ${
            error
              ? 'border-rose-500/50 focus:border-rose-500/60 focus:ring-rose-500/30'
              : 'border-slate-700/50 hover:border-slate-600/50'
          } ${className}`}
          {...props}
        />
        {error && <p className="text-xs text-rose-400 mt-1.5">{error}</p>}
        {!error && helperText && <p className="text-xs text-slate-500 mt-1.5">{helperText}</p>}
      </div>
    );
  }
);

Textarea.displayName = 'Textarea';
