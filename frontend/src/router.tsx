import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  useNavigate,
  useLocation,
} from '@tanstack/react-router';
import { AppShell } from './components/layout/AppShell';
import { AuthGuard } from './components/AuthGuard';
import { ToastProvider } from './components/ui/Toast';
import { BatchesPage } from './pages/BatchesPage';
import { DivisionsPage } from './pages/DivisionsPage';
import { LoginPage } from './pages/LoginPage';
import { PlaceholderPage } from './pages/PlaceholderPage';
import { RoomsPage } from './pages/RoomsPage';
import { SubjectsPage } from './pages/SubjectsPage';
import { TeachersPage } from './pages/TeachersPage';
import { TimetablePage } from './pages/TimetablePage';

// Root route: only renders the outlet. The shell lives in the pathless
// "_app" layout below so that /login can render without it.
// The ToastProvider sits here so that both the login page (outside the
// AuthGuard) and the app can raise toasts.
const rootRoute = createRootRoute({
  component: () => (
    <ToastProvider>
      <Outlet />
    </ToastProvider>
  ),
});

// Pathless layout route: the authenticated app (sidebar + pages), gated by
// the AuthGuard. Child routes keep their own paths.
const appLayoutRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: '_app',
  component: () => {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const location = useLocation();
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const navigate = useNavigate();

    return (
      <AuthGuard>
        <AppShell
          currentPath={location.pathname}
          onNavigate={(path) => {
            navigate({ to: path });
          }}
        >
          <Outlet />
        </AppShell>
      </AuthGuard>
    );
  },
});

// Public login route (outside the AuthGuard)
const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  component: () => <LoginPage />,
});

// Index route redirects to /divisions
const indexRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/',
  component: () => <DivisionsPage />,
});

// Divisions route (Slice 1)
const divisionsRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/divisions',
  component: () => <DivisionsPage />,
});

// Setup module routes
const batchesRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/batches',
  component: () => <BatchesPage />,
});

const subjectsRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/subjects',
  component: () => <SubjectsPage />,
});

const roomsRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/rooms',
  component: () => <RoomsPage />,
});

const teachersRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/teachers',
  component: () => <TeachersPage />,
});

const eligibilityRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/eligibility',
  component: () => <PlaceholderPage path="/eligibility" />,
});

const requirementsRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/requirements',
  component: () => <PlaceholderPage path="/requirements" />,
});

const timetableSettingsRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/timetable/settings',
  component: () => <PlaceholderPage path="/timetable/settings" />,
});

const timetableGenerateRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/timetable/generate',
  component: () => <TimetablePage />,
});

const timetableGridRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/timetable/grid',
  component: () => <TimetablePage />,
});

const exportRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/export',
  component: () => <PlaceholderPage path="/export" />,
});

const routeTree = rootRoute.addChildren([
  loginRoute,
  appLayoutRoute.addChildren([
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
  ]),
]);

export const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
