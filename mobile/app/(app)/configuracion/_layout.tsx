import { Stack } from 'expo-router';

// Same reason as producto/_layout.tsx: without a nested layout, Expo Router
// flattens every file in this directory into its own entry in the parent Tabs
// navigator. Unlike `producto`, this directory IS a visible tab — the existing
// `<Tabs.Screen name="configuracion">` in app/(app)/_layout.tsx resolves to
// this Stack, and needs no change.
export default function ConfiguracionLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
