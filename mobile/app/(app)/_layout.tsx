import { Redirect, Tabs } from 'expo-router';
import { useSession } from '../../src/hooks/useSession';
import { useRevocationGuard } from '../../src/hooks/useRevocationGuard';
import type { DeviceRole } from '../../src/types/api';

const TABS_BY_ROLE: Record<DeviceRole, string[]> = {
  ADMIN: ['dashboard', 'inventario', 'post-venta', 'configuracion', 'invitar'],
  INVENTARIO: ['inventario'],
  POST_VENTA: ['post-venta'],
  CLIENTE_PEDIDOS: [],
};

export default function AppLayout() {
  const session = useSession();
  useRevocationGuard();

  // Only an ACTIVE session may mount the tab shell — a persisted PENDING or
  // REVOKED device is ejected before it renders, not after /auth/me answers.
  if (session?.status !== 'ACTIVE') {
    return <Redirect href="/(auth)/home" />;
  }

  // `?? []` because an unrecognized role must not throw here: the session is
  // persisted, so a crash would repeat on every launch. `isValidSession`
  // already rejects unknown roles at load time; this is the second layer.
  const visibleTabs = TABS_BY_ROLE[session.role] ?? [];

  return (
    <Tabs screenOptions={{ headerShown: false }}>
      <Tabs.Screen
        name="dashboard"
        options={{ href: visibleTabs.includes('dashboard') ? undefined : null, title: 'Dashboard' }}
      />
      <Tabs.Screen
        name="inventario"
        options={{ href: visibleTabs.includes('inventario') ? undefined : null, title: 'Inventario' }}
      />
      <Tabs.Screen
        name="post-venta"
        options={{ href: visibleTabs.includes('post-venta') ? undefined : null, title: 'Post-Venta' }}
      />
      <Tabs.Screen
        name="configuracion"
        options={{
          href: visibleTabs.includes('configuracion') ? undefined : null,
          title: 'Configuración',
        }}
      />
      <Tabs.Screen
        name="invitar"
        options={{ href: visibleTabs.includes('invitar') ? undefined : null, title: 'Invitar' }}
      />
      {/* Reached only via router.push from inventario.tsx — never a tab. */}
      <Tabs.Screen name="escanear" options={{ href: null, title: 'Escanear' }} />
      {/* Reached only via router.push from post-venta.tsx — never a tab. */}
      <Tabs.Screen name="vender-escanear" options={{ href: null, title: 'Escanear' }} />
      {/* `producto/` has its own _layout.tsx (a Stack), so the whole
          subdirectory collapses into this single entry — hiding it here
          hides [barcode].tsx and nuevo.tsx together, present or not. */}
      <Tabs.Screen name="producto" options={{ href: null, title: 'Producto' }} />
    </Tabs>
  );
}
