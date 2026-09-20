import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { PaperProvider } from 'react-native-paper';
import { QueryClientProvider } from '@tanstack/react-query';
import { StyleSheet, View, useColorScheme } from 'react-native';
import * as SystemUI from 'expo-system-ui';
import { ErrorBoundary } from '../src/errors/ErrorBoundary';
import { ToastProvider } from '../src/feedback/ToastProvider';
import { lightTheme, darkTheme } from '../src/theme/theme';
import { queryClient } from '../src/services/queryClient';
import { useSessionHydration } from '../src/hooks/useSessionHydration';

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const theme = colorScheme === 'dark' ? darkTheme : lightTheme;
  const hydrated = useSessionHydration();
  const background = theme.colors.background;

  // Paint the native root view too, so the background behind and around the
  // React tree (and during the splash hand-off) matches the active theme.
  useEffect(() => {
    void SystemUI.setBackgroundColorAsync(background).catch(() => undefined);
  }, [background]);

  if (!hydrated) {
    return <View style={[styles.root, { backgroundColor: background }]} />;
  }

  return (
    <ErrorBoundary>
      <PaperProvider theme={theme}>
        <QueryClientProvider client={queryClient}>
          <ToastProvider>
            <View style={[styles.root, { backgroundColor: background }]}>
              <Stack
                screenOptions={{
                  headerShown: false,
                  contentStyle: { backgroundColor: background },
                }}
              />
            </View>
          </ToastProvider>
        </QueryClientProvider>
      </PaperProvider>
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
