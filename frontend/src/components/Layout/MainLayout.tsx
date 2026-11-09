import { Outlet, Link, useLocation, NavLink } from 'react-router-dom';
import { useSyncExternalStore } from 'react';
import { subscribeMock, mockSnapshot } from '../../api/client';
import { request } from '../../api/client';
import { uuid } from '../../telemetry/ids';
import { useQuery } from '@tanstack/react-query';
import { Settings } from 'lucide-react';

export function MainLayout() {
  const location = useLocation();
  const mock = useSyncExternalStore(subscribeMock, mockSnapshot);
  const health = useQuery({
    queryKey: ['health'],
    queryFn: () => request<{ status: string }>('/health', uuid()),
    retry: false,
    refetchInterval: 30000,
    refetchOnWindowFocus: false,
  });

  return (
    <>
      <header className="header">
        <Link className="brand" to="/" aria-label="AI Invest Recommender, главная">
          <span className="brand-mark">AI</span>
          <span>AI Invest Recommender</span>
        </Link>
        <div className="header-center">
          <span
            className={`health-dot ${health.data?.status === 'ok' ? 'online' : ''}`}
            title={health.data?.status === 'ok' ? 'Сервис доступен' : 'Нет соединения с сервером'}
            aria-label={health.data?.status === 'ok' ? 'Сервис доступен' : 'Сервер недоступен'}
          />
          {mock && <span className="mock-badge">MOCK</span>}
        </div>
        <nav className="header-nav" aria-label="Основная навигация">
          <NavLink
            to="/"
            className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
            aria-current={location.pathname === '/' ? 'page' : undefined}
          >
            Рекомендации
          </NavLink>
          <NavLink
            to="/settings"
            className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
            aria-current={location.pathname === '/settings' ? 'page' : undefined}
          >
            <Settings size={17} />
            <span>Настройки</span>
          </NavLink>
        </nav>
      </header>
      <main className="main">
        <Outlet />
        <footer className="footer">
          <span>© 2025 AI Invest Recommender</span>
        </footer>
      </main>
    </>
  );
}
