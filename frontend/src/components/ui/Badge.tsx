import React from 'react';

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: 'outline' | 'solid' | 'status-active' | 'status-inactive' | 'role';
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
    sm: 'text-[11px] px-1.5 py-0.5 leading-none',
    md: 'text-xs px-2 py-0.5 leading-normal',
  };

  const variantStyles = {
    // Status outline styles
    outline: 'border border-slate-300 text-slate-700 bg-white font-medium',
    'status-active': 'border border-slate-400 text-slate-800 bg-white font-semibold',
    'status-inactive': 'border border-slate-200 text-slate-400 bg-white line-through font-normal',

    // Role solid styles (subtle solid, not soft pastel pill)
    solid: 'bg-slate-100 text-slate-700 border border-slate-200 font-medium',
    role: 'bg-slate-100 text-slate-800 border border-slate-300 font-semibold uppercase tracking-wider text-[11px]',
  };

  return (
    <span
      className={`inline-flex items-center justify-center rounded-[3px] select-none ${sizeStyles[size]} ${variantStyles[variant]} ${className}`}
      {...props}
    >
      {children}
    </span>
  );
};
