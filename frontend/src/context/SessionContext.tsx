import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { readStorage, writeStorage, uuid, type Identity } from '../telemetry/ids';

type AppContextValue = {
  identity: Identity;
  dev: boolean;
  legacyUserId: string;
  setLegacyUserId: (value: string) => void;
};

const Context = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [identity] = useState<Identity>(() => {
    const stored = readStorage<Identity>('app.identity', {
      session_id: uuid(),
      journey_id: uuid(),
      user_id: null,
      actor_kind: 'human',
      run_id: null,
      persona_id: null,
      seed: null,
      last_active: Date.now(),
    });
    if (stored?.journey_id) return stored;
    return {
      session_id: uuid(),
      journey_id: uuid(),
      user_id: null,
      actor_kind: 'human',
      run_id: null,
      persona_id: null,
      seed: null,
      last_active: Date.now(),
    };
  });
  const [legacyUserId, changeLegacy] = useState(() =>
    String(readStorage<string>('app.legacy-user', '1')),
  );
  const [dev] = useState(() => new URLSearchParams(location.search).get('dev') === '1');

  // Persist identity
  useEffect(() => {
    writeStorage('app.identity', identity);
  }, [identity]);

  const setLegacyUserId = (value: string) => {
    changeLegacy(value);
    writeStorage('app.legacy-user', value);
  };

  return (
    <Context.Provider
      value={{
        identity,
        dev,
        legacyUserId,
        setLegacyUserId,
      }}
    >
      {children}
    </Context.Provider>
  );
}

export function useAppContext() {
  const ctx = useContext(Context);
  if (!ctx) throw new Error('AppProvider is required');
  return ctx;
}
