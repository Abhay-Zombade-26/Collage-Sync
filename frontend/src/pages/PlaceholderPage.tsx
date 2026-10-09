import React from 'react';
import { PageHeader } from '../components/ui/PageHeader';
import { EmptyState } from '../components/ui/EmptyState';
import { APP_ROUTES } from '../routes';

interface PlaceholderPageProps {
  path: string;
}

export const PlaceholderPage: React.FC<PlaceholderPageProps> = ({ path }) => {
  const allItems = APP_ROUTES.flatMap((s) => s.items);
  const item = allItems.find((i) => i.path === path);

  const title = item ? item.label : 'Section';
  const subtitle = item ? item.description : 'System administration module';

  return (
    <div className="space-y-4">
      <PageHeader title={title} subtitle={subtitle} />
      <EmptyState
        title="Module Not Built Yet"
        description={`The ${title} slice is scheduled in the roadmap and will be activated once prerequisites are completed.`}
        icon={
          <svg
            className="w-5 h-5 text-slate-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="1.5"
              d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
        }
      />
    </div>
  );
};
