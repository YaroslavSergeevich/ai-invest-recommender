import ReactDOM from 'react-dom/client';
import App from './App';
import { initTracker } from './telemetry/tracker';
import { installAgentTiming } from './telemetry/visibility';
import './styles/globals.css';
initTracker();
installAgentTiming();
document.title = import.meta.env.VITE_APP_TITLE || 'Альфа-Бизнес · Новостные рекомендации';
ReactDOM.createRoot(document.getElementById('root')!).render(<App />);
