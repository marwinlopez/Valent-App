import { Redirect, type Href } from 'expo-router';
import { useSession } from '../src/hooks/useSession';
import type { DeviceRole } from '../src/types/api';

const HOME: Href = '/(auth)/home';

const FIRST_TAB_BY_ROLE: Record<DeviceRole, Href> = {
  ADMIN: '/(app)/dashboard',
  INVENTARIO: '/(app)/inventario',
  POST_VENTA: '/(app)/post-venta',
  CLIENTE_PEDIDOS: HOME, // no shell yet — sub-project 6 replaces this
};

export default function Index() {
  const session = useSession();

  // A session only counts as valid when it is ACTIVE: a persisted PENDING or
  // REVOKED device belongs on Home, not in the tab shell.
  if (session?.status !== 'ACTIVE') {
    return <Redirect href={HOME} />;
  }

  return <Redirect href={FIRST_TAB_BY_ROLE[session.role] ?? HOME} />;
}
