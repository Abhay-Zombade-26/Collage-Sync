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
      'inline-flex items-center justify-center font-medium transition-colors select-none rounded focus:outline-none focus:ring-2 focus:ring-accent/20 focus:ring-offset-1 disabled:opacity-50 disabled:cursor-not-allowed';

    const sizeStyles = {
      sm: 'text-xs px-2.5 py-1.5 gap-1.5 h-7',
      md: 'text-sm px-3.5 py-2 gap-2 h-9',
      lg: 'text-sm px-4 py-2.5 gap-2 h-10',
    };

    const variantStyles = {
      primary:
        'bg-accent text-white hover:bg-accent-hover active:bg-blue-800 border border-transparent shadow-none',
      secondary:
        'bg-surface text-slate-700 hover:bg-slate-50 active:bg-slate-100 border border-slate-200',
      danger:
        'bg-danger text-white hover:bg-danger-hover active:bg-red-800 border border-transparent',
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
