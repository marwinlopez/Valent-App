import { Redirect, type Href } from 'expo-router';
import { useSessionStore } from '../src/state/sessionStore';
import type { DeviceRole } from '../src/types/api';

const FIRST_TAB_BY_ROLE: Record<DeviceRole, Href> = {
  ADMIN: '/(app)/dashboard',
  INVENTARIO: '/(app)/inventario',
  POST_VENTA: '/(app)/post-venta',
  CLIENTE_PEDIDOS: '/(auth)/home', // no shell yet — sub-project 6 replaces this
};

export default function Index() {
  const session = useSessionStore((state) => state.session);

  return <Redirect href={session ? FIRST_TAB_BY_ROLE[session.role] : '/(auth)/home'} />;
}
