import { useLayoutEffect, useRef } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigationType } from 'react-router-dom';
import { MainLayout } from './components/Layout/MainLayout';
import { RecommendationsPage } from './pages/RecommendationsPage';
import { SettingsPage } from './pages/SettingsPage';
import { visitPage } from './telemetry/tracker';

export function AppRoutes() {
  const location = useLocation();
  const type = useNavigationType();
  const initial = useRef(true);
  useLayoutEffect(() => {
    const navigation = performance.getEntriesByType('navigation')[0] as
      PerformanceNavigationTiming | undefined;
    const kind = initial.current
      ? navigation?.type === 'reload'
        ? 'reload'
        : 'initial'
      : type === 'POP'
        ? 'history'
        : 'route';
    visitPage(
      location.pathname === '/settings' ? 'settings' : 'recommendations',
      kind,
      location.key,
    );
    initial.current = false;
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, [location.key, location.pathname, type]);
  return (
    <Routes>
      <Route element={<MainLayout />}>
        <Route path="/" element={<RecommendationsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
