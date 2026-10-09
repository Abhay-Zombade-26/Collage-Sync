import React from 'react';

export const Table: React.FC<React.TableHTMLAttributes<HTMLTableElement>> = ({
  className = '',
  children,
  ...props
}) => (
  <div className="w-full overflow-x-auto border border-slate-200 rounded bg-surface">
    <table className={`w-full text-left border-collapse text-sm ${className}`} {...props}>
      {children}
    </table>
  </div>
);

export const TableHeader: React.FC<React.HTMLAttributes<HTMLTableSectionElement>> = ({
  className = '',
  children,
  ...props
}) => (
  <thead
    className={`bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-500 uppercase tracking-wider ${className}`}
    {...props}
  >
    {children}
  </thead>
);

export const TableBody: React.FC<React.HTMLAttributes<HTMLTableSectionElement>> = ({
  className = '',
  children,
  ...props
}) => (
  <tbody className={`divide-y divide-slate-200 ${className}`} {...props}>
    {children}
  </tbody>
);

export const TableRow: React.FC<React.HTMLAttributes<HTMLTableRowElement>> = ({
  className = '',
  children,
  ...props
}) => (
  <tr className={`hover:bg-slate-50/80 transition-colors duration-75 ${className}`} {...props}>
    {children}
  </tr>
);

export const TableHead: React.FC<React.ThHTMLAttributes<HTMLTableCellElement>> = ({
  className = '',
  children,
  ...props
}) => (
  <th className={`px-4 py-2.5 font-semibold select-none ${className}`} {...props}>
    {children}
  </th>
);

export const TableCell: React.FC<
  React.TdHTMLAttributes<HTMLTableCellElement> & { isCode?: boolean }
> = ({ className = '', isCode = false, children, ...props }) => (
  <td
    className={`px-4 py-2.5 text-slate-800 ${
      isCode ? 'font-mono text-xs text-slate-600' : 'text-sm'
    } ${className}`}
    {...props}
  >
    {children}
  </td>
);
