import { Settings, Construction } from 'lucide-react';

export function SettingsPage() {
  return (
    <div className="settings-page" data-testid="settings-page">
      <div className="settings-container">
        <div className="settings-header">
          <div className="settings-icon">
            <Construction size={48} />
          </div>
          <h1>Настройки</h1>
          <p>Раздел в разработке</p>
        </div>
        <div className="settings-content">
          <section className="settings-section">
            <h2>Планируемые настройки</h2>
            <ul className="settings-list">
              <li>
                <Settings size={18} />
                <span>Профиль пользователя</span>
              </li>
              <li>
                <Settings size={18} />
                <span>Настройки уведомлений</span>
              </li>
              <li>
                <Settings size={18} />
                <span>Тема интерфейса (светлая/тёмная)</span>
              </li>
              <li>
                <Settings size={18} />
                <span>Источники рекомендаций</span>
              </li>
              <li>
                <Settings size={18} />
                <span>API ключи и интеграции</span>
              </li>
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
