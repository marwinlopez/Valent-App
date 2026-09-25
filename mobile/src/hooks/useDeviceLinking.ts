import { useCallback, useState } from 'react';
import { router } from 'expo-router';
import { linkDevice, readDeviceIdFromJwt } from '../services/api/auth';
import { getHardwareId, getSuggestedDeviceName } from '../services/device/hardwareId';
import { signIn } from '../services/session';
import { ApiRequestError } from '../services/api/client';

/* No 'scanning' state: the scanner is its own route, so nothing here would ever
   set or read it. */
export type LinkingState = 'idle' | 'manual' | 'confirming' | 'submitting' | 'error';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Messages are chosen per backend error code, not per HTTP status: 422 and 403
 * each cover several distinct situations, and "no se pudo vincular" tells the
 * person in the shop nothing about what to do next.
 */
const MESSAGE_BY_CODE: Record<string, string> = {
  INVALID_INVITE_TOKEN: 'Ese código no es válido, ya fue usado o expiró. Pídele al administrador uno nuevo.',
  DEVICE_LIMIT_REACHED: 'Esta cuenta ya llegó a su límite de dispositivos vinculados.',
  DEVICE_REVOKED: 'Este dispositivo fue revocado. Contacta al administrador.',
  VALIDATION_ERROR: 'Este dispositivo no pudo enviar sus datos de identificación. Inténtalo de nuevo y, si sigue igual, avísale al administrador.',
};

const FALLBACK_MESSAGE = 'No se pudo vincular el dispositivo. Revisa tu conexión e inténtalo de nuevo.';
const INVALID_FORMAT_MESSAGE = 'Ese código no tiene el formato correcto. Revísalo e inténtalo de nuevo.';

export function useDeviceLinking() {
  const [state, setState] = useState<LinkingState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);

  const startManual = useCallback(() => {
    setError(null);
    setState('manual');
  }, []);

  const reset = useCallback(() => {
    setError(null);
    setToken(null);
    setState('idle');
  }, []);

  /** Validates locally first: the backend answers 422 either way, but a round
   *  trip to be told "invalid" is slower and vaguer than saying so here. */
  const submitToken = useCallback((candidate: string) => {
    const trimmed = candidate.trim();
    if (!UUID_PATTERN.test(trimmed)) {
      setError(INVALID_FORMAT_MESSAGE);
      setState('manual');
      return;
    }
    setError(null);
    setToken(trimmed);
    setState('confirming');
  }, []);

  const confirmName = useCallback(
    async (deviceName: string) => {
      if (!token) {
        setError(FALLBACK_MESSAGE);
        setState('error');
        return;
      }

      setState('submitting');
      setError(null);
      try {
        const hardwareId = await getHardwareId();
        const response = await linkDevice({ inviteToken: token, hardwareId, deviceName: deviceName.trim() });

        // The endpoint returns neither deviceId nor status: deviceId is read
        // from the JWT (an untrusted local hint, never an authorization input),
        // and link-device's success path always leaves the device ACTIVE.
        // An undecodable JWT has to fail the link: a session with an empty
        // deviceId is rejected on the next launch and silently unlinks.
        const deviceId = readDeviceIdFromJwt(response.jwt);
        if (!deviceId) {
          throw new Error('El JWT recibido no trae deviceId.');
        }

        await signIn({
          deviceId,
          accountId: response.accountId,
          role: response.role,
          status: 'ACTIVE',
          jwt: response.jwt,
        });
        // The route gate in app/index.tsx is a <Redirect> that already unmounted
        // at launch, so it never re-evaluates on its own. Remounting it is what
        // routes this freshly linked device to its role's first tab.
        router.replace('/');
      } catch (err) {
        const code = err instanceof ApiRequestError ? err.code : null;
        setError((code && MESSAGE_BY_CODE[code]) ?? FALLBACK_MESSAGE);
        setState('error');
      }
    },
    [token]
  );

  return {
    state,
    error,
    suggestedName: getSuggestedDeviceName(),
    startManual,
    submitToken,
    confirmName,
    reset,
  };
}
