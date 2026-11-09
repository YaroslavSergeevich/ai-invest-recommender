import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AppProvider } from './context/SessionContext';
import { ToastProvider } from './components/UI/Toast';
import { AppRoutes } from './routes';
const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
});
export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AppProvider>
          <ToastProvider>
            <AppRoutes />
          </ToastProvider>
        </AppProvider>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
