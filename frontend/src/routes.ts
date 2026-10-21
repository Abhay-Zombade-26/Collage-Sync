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
        id: 'branches',
        label: 'Branches',
        path: '/branches',
        description: 'Manage academic branches (e.g. IT, CSE)',
        status: 'active',
      },
      {
        id: 'divisions',
        label: 'Divisions',
        path: '/divisions',
        description: 'Manage academic divisions (e.g. 2nd Year IT - Division A)',
        status: 'active',
      },
      {
        id: 'subjects',
        label: 'Subjects',
        path: '/subjects',
        description: 'Manage courses and subject codes',
        status: 'active',
      },
      {
        id: 'rooms',
        label: 'Rooms',
        path: '/rooms',
        description: 'Manage classrooms and laboratories scoped to divisions',
        status: 'active',
      },
      {
        id: 'teachers',
        label: 'Teachers',
        path: '/teachers',
        description: 'Manage faculty roster (Regular and Visiting availability)',
        status: 'active',
      },
    ],
  },
  {
    title: 'ALLOCATION',
    items: [
      {
        id: 'eligibility',
        label: 'Teacher Class Subject',
        path: '/eligibility',
        description: 'Teacher ↔ Subject ↔ Division mapping matrix',
        status: 'active',
      },
    ],
  },
  {
    title: 'TIMETABLE',
    items: [
      {
        id: 'timetable',
        label: 'Timetable',
        path: '/timetable/grid',
        description: 'Generate a timetable and review the weekly master grid',
        status: 'active',
      },
    ],
  },
];
