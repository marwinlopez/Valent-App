import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { PaperProvider } from 'react-native-paper';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useColorScheme } from 'react-native';
import { ErrorBoundary } from '../src/errors/ErrorBoundary';
import { ToastProvider } from '../src/feedback/ToastProvider';
import { lightTheme, darkTheme } from '../src/theme/theme';
import { useSessionStore } from '../src/state/sessionStore';
import { loadSession } from '../src/services/storage/secureSession';

const queryClient = new QueryClient();

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const setSession = useSessionStore((state) => state.setSession);
  const setHydrated = useSessionStore((state) => state.setHydrated);
  const hydrated = useSessionStore((state) => state.hydrated);

  useEffect(() => {
    loadSession().then((session) => {
      if (session) setSession(session);
      setHydrated(true);
    });
  }, [setSession, setHydrated]);

  if (!hydrated) {
    return null;
  }

  return (
    <ErrorBoundary>
      <PaperProvider theme={colorScheme === 'dark' ? darkTheme : lightTheme}>
        <QueryClientProvider client={queryClient}>
          <ToastProvider>
            <Stack screenOptions={{ headerShown: false }} />
          </ToastProvider>
        </QueryClientProvider>
      </PaperProvider>
    </ErrorBoundary>
  );
}
