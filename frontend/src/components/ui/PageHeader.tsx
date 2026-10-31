import React from 'react';

export interface PageHeaderProps {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}

export const PageHeader: React.FC<PageHeaderProps> = ({ title, subtitle, action }) => {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-4 mb-5 border-b border-slate-200">
      <div className="spring-in">
        <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900 leading-tight">
          {title}
        </h1>
        {subtitle && (
          <p className="text-xs text-slate-500 font-medium mt-1 tracking-normal">
            {subtitle}
          </p>
        )}
      </div>
      {action && <div className="flex items-center gap-2 shrink-0 spring-in delay-1">{action}</div>}
    </div>
  );
};
