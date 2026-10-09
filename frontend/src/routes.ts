export interface RouteItem {
  id: string;
  label: string;
  path: string;
  description: string;
  status: 'active' | 'placeholder';
}

export interface RouteSection {
  title: string;
  items: RouteItem[];
}

export const APP_ROUTES: RouteSection[] = [
  {
    title: 'SETUP',
    items: [
      {
        id: 'divisions',
        label: 'Divisions',
        path: '/divisions',
        description: 'Manage academic divisions (e.g. 2nd Year IT - Division A)',
        status: 'active',
      },
      {
        id: 'batches',
        label: 'Batches',
        path: '/batches',
        description: 'Manage lab practical batches scoped to divisions',
        status: 'placeholder',
      },
      {
        id: 'subjects',
        label: 'Subjects',
        path: '/subjects',
        description: 'Manage courses and subject codes',
        status: 'placeholder',
      },
      {
        id: 'rooms',
        label: 'Rooms',
        path: '/rooms',
        description: 'Manage classrooms and laboratories scoped to divisions',
        status: 'placeholder',
      },
      {
        id: 'teachers',
        label: 'Teachers',
        path: '/teachers',
        description: 'Manage faculty roster (Regular and Visiting availability)',
        status: 'placeholder',
      },
    ],
  },
  {
    title: 'ALLOCATION',
    items: [
      {
        id: 'eligibility',
        label: 'Eligibility Matrix',
        path: '/eligibility',
        description: 'Teacher ↔ Subject ↔ Division mapping matrix',
        status: 'placeholder',
      },
      {
        id: 'requirements',
        label: 'Weekly Requirements',
        path: '/requirements',
        description: 'Weekly workload hours for theory, practical, and tutorials',
        status: 'placeholder',
      },
    ],
  },
  {
    title: 'TIMETABLE',
    items: [
      {
        id: 'settings',
        label: 'Settings Wizard',
        path: '/timetable/settings',
        description: 'Configure daily timings, slot durations, and lunch boundaries',
        status: 'placeholder',
      },
      {
        id: 'generate',
        label: 'Generate & Review',
        path: '/timetable/generate',
        description: 'Trigger solver generation and review conflict status',
        status: 'placeholder',
      },
      {
        id: 'grid',
        label: 'Master Grid',
        path: '/timetable/grid',
        description: 'Weekly division timetable view with slot locking',
        status: 'placeholder',
      },
    ],
  },
  {
    title: 'REPORTS',
    items: [
      {
        id: 'export',
        label: 'Export',
        path: '/export',
        description: 'Download master schedules as PDF or Excel',
        status: 'placeholder',
      },
    ],
  },
];
