import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { Snackbar } from 'react-native-paper';

interface ToastContextValue {
  showToast: (message: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState<string | null>(null);

  const showToast = useCallback((next: string) => setMessage(next), []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <Snackbar visible={message !== null} onDismiss={() => setMessage(null)} duration={3000}>
        {message}
      </Snackbar>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
}
