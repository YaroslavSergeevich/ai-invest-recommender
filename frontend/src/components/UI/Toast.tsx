import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { AlertCircle, CheckCircle2, X } from 'lucide-react';
const Context = createContext<(text?: string, success?: boolean) => void>(() => {});
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<{ id: number; text: string; success: boolean } | null>(null);
  const notify = useCallback((text = 'Сервис недоступен, попробуйте позже', success = false) => {
    const id = Date.now();
    setToast({ id, text, success });
    setTimeout(() => setToast((value) => (value?.id === id ? null : value)), 5000);
  }, []);
  return (
    <Context.Provider value={notify}>
      {children}
      {toast && (
        <div className="toast" role={toast.success ? 'status' : 'alert'}>
          {toast.success ? <CheckCircle2 size={20} /> : <AlertCircle size={20} />}
          <span>{toast.text}</span>
          <button aria-label="Закрыть уведомление" onClick={() => setToast(null)}>
            <X size={17} />
          </button>
        </div>
      )}
    </Context.Provider>
  );
}
export const useToast = () => useContext(Context);
