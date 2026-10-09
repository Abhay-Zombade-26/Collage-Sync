import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  useNavigate,
  useLocation,
} from '@tanstack/react-router';
import { AppShell } from './components/layout/AppShell';
import { DivisionsPage } from './pages/DivisionsPage';
import { PlaceholderPage } from './pages/PlaceholderPage';

// Root route wrapping layout
const rootRoute = createRootRoute({
  component: () => {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const location = useLocation();
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const navigate = useNavigate();

    return (
      <AppShell
        currentPath={location.pathname}
        onNavigate={(path) => {
          navigate({ to: path });
        }}
      >
        <Outlet />
      </AppShell>
    );
  },
});

// Index route redirects to /divisions
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: () => <DivisionsPage />,
});

// Divisions route (Slice 1)
const divisionsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/divisions',
  component: () => <DivisionsPage />,
});

// Placeholder routes
const batchesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/batches',
  component: () => <PlaceholderPage path="/batches" />,
});

const subjectsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/subjects',
  component: () => <PlaceholderPage path="/subjects" />,
});

const roomsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/rooms',
  component: () => <PlaceholderPage path="/rooms" />,
});

const teachersRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/teachers',
  component: () => <PlaceholderPage path="/teachers" />,
});

const eligibilityRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/eligibility',
  component: () => <PlaceholderPage path="/eligibility" />,
});

const requirementsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/requirements',
  component: () => <PlaceholderPage path="/requirements" />,
});

const timetableSettingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/timetable/settings',
  component: () => <PlaceholderPage path="/timetable/settings" />,
});

const timetableGenerateRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/timetable/generate',
  component: () => <PlaceholderPage path="/timetable/generate" />,
});

const timetableGridRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/timetable/grid',
  component: () => <PlaceholderPage path="/timetable/grid" />,
});

const exportRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/export',
  component: () => <PlaceholderPage path="/export" />,
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  divisionsRoute,
  batchesRoute,
  subjectsRoute,
  roomsRoute,
  teachersRoute,
  eligibilityRoute,
  requirementsRoute,
  timetableSettingsRoute,
  timetableGenerateRoute,
  timetableGridRoute,
  exportRoute,
]);

export const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
