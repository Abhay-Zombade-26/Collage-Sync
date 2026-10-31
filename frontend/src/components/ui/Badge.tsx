import React from 'react';

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: 'outline' | 'solid' | 'status-active' | 'status-inactive' | 'role' | 'cyber';
  size?: 'sm' | 'md';
}

export const Badge: React.FC<BadgeProps> = ({
  variant = 'outline',
  size = 'md',
  className = '',
  children,
  ...props
}) => {
  const sizeStyles = {
    sm: 'text-[10px] px-2 py-0.5 leading-none',
    md: 'text-[11px] px-2.5 py-1 leading-normal',
  };

  const variantStyles = {
    outline: 'border border-slate-200 text-slate-700 bg-slate-50 font-medium',
    'status-active': 'border border-emerald-200 text-emerald-700 bg-emerald-50 font-semibold',
    'status-inactive': 'border border-slate-200 text-slate-400 bg-slate-100 line-through font-normal',
    solid: 'bg-slate-100 text-slate-700 border border-slate-200 font-medium',
    role: 'bg-blue-50 text-blue-700 border border-blue-200 font-semibold uppercase tracking-wider',
    cyber: 'bg-slate-100 text-slate-700 border border-slate-200 font-medium',
  };

  return (
    <span
      className={`inline-flex items-center justify-center rounded-md select-none ${sizeStyles[size]} ${variantStyles[variant]} ${className}`}
      {...props}
    >
      {children}
    </span>
  );
};
