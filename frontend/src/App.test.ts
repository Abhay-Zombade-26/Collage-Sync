import { describe, it, expect } from 'vitest';
import { APP_ROUTES } from './routes';

describe('Route Registry', () => {
  it('registers all required sidebar sections', () => {
    const titles = APP_ROUTES.map((s) => s.title);
    expect(titles).toEqual(['SETUP', 'ALLOCATION', 'TIMETABLE', 'REPORTS']);
  });

  it('contains the active divisions route', () => {
    const divisionsRoute = APP_ROUTES[0]?.items.find((i) => i.id === 'divisions');
    expect(divisionsRoute).toBeDefined();
    expect(divisionsRoute?.path).toBe('/divisions');
    expect(divisionsRoute?.status).toBe('active');
  });
});
