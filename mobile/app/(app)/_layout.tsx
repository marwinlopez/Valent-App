import { Redirect, Tabs } from 'expo-router';
import { useEffect } from 'react';
import { useSession } from '../../src/hooks/useSession';
import { useAuthStatus } from '../../src/hooks/useAuthStatus';
import { useSessionStore } from '../../src/state/sessionStore';
import { deleteSession } from '../../src/services/storage/secureSession';
import type { DeviceRole } from '../../src/types/api';

const TABS_BY_ROLE: Record<DeviceRole, string[]> = {
  ADMIN: ['dashboard', 'inventario', 'post-venta', 'configuracion'],
  INVENTARIO: ['inventario'],
  POST_VENTA: ['post-venta'],
  CLIENTE_PEDIDOS: [],
};

export default function AppLayout() {
  const session = useSession();
  const clearSession = useSessionStore((state) => state.clearSession);
  const { data: authStatus } = useAuthStatus();

  useEffect(() => {
    if (authStatus && authStatus.status !== 'ACTIVE') {
      clearSession();
      deleteSession();
    }
  }, [authStatus, clearSession]);

  if (!session) {
    return <Redirect href="/(auth)/home" />;
  }

  const visibleTabs = TABS_BY_ROLE[session.role];

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
        options={{ href: visibleTabs.includes('configuracion') ? undefined : null, title: 'Configuración' }}
      />
    </Tabs>
  );
}
