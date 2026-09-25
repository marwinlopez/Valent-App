import { Stack } from 'expo-router';

// Without this layout, Expo Router flattens every file in this directory
// (`[barcode].tsx`, and Task 8's `nuevo.tsx`) into its own top-level entry in
// the parent Tabs navigator — the same bug Task 6 hit with `escanear.tsx`.
// A nested `_layout.tsx` turns the whole directory into one Stack, so the
// parent sees a single "producto" route to hide, regardless of how many
// files live under here.
export default function ProductoLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
