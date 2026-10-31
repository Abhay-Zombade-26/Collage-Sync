import React from 'react';
import { LoadingSpinner } from './LoadingSpinner';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  isLoading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = 'primary',
      size = 'md',
      isLoading = false,
      leftIcon,
      rightIcon,
      disabled,
      children,
      className = '',
      ...props
    },
    ref
  ) => {
    const baseStyles =
      'inline-flex items-center justify-center font-display font-semibold transition-all select-none rounded-lg focus-ring disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.97]';

    const sizeStyles = {
      sm: 'text-xs px-3 py-2 gap-1.5 h-8',
      md: 'text-sm px-4 py-2.5 gap-2 h-10',
      lg: 'text-sm px-5 py-3 gap-2 h-11',
    };

    const variantStyles = {
      primary:
        'bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-medium shadow-sm transition-colors duration-150 border border-blue-600',
      secondary:
        'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 hover:border-slate-300 shadow-sm transition-colors duration-150',
      danger:
        'bg-white border border-rose-200 text-rose-600 hover:bg-rose-50 hover:border-rose-300 shadow-sm transition-colors duration-150',
    };

    const isDisabled = disabled || isLoading;

    return (
      <button
        ref={ref}
        disabled={isDisabled}
        className={`${baseStyles} ${sizeStyles[size]} ${variantStyles[variant]} ${className}`}
        {...props}
      >
        {isLoading ? (
          <>
            <LoadingSpinner size="sm" />
            <span>{children}</span>
          </>
        ) : (
          <>
            {leftIcon && <span className="inline-flex shrink-0">{leftIcon}</span>}
            <span>{children}</span>
            {rightIcon && <span className="inline-flex shrink-0">{rightIcon}</span>}
          </>
        )}
      </button>
    );
  }
);

Button.displayName = 'Button';
