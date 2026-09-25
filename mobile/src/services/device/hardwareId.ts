import { Platform } from 'react-native';
import * as Application from 'expo-application';
import * as Device from 'expo-device';

/**
 * A per-install identifier the backend uses to recognise a returning device
 * (`devices.hardware_id`, unique per account).
 *
 * Web has no hardware identifier at all. Web is a development-only target
 * (see AGENTS.md), so it gets a generated id held for the lifetime of the
 * page — enough to exercise the linking flow, and deliberately not persisted
 * anywhere that would imply it means something.
 */
let generatedId: string | null = null;

function getGeneratedId(): string {
  if (!generatedId) {
    generatedId = `web-${globalThis.crypto.randomUUID()}`;
  }
  return generatedId;
}

export async function getHardwareId(): Promise<string> {
  if (Platform.OS === 'android') {
    return Application.getAndroidId();
  }

  if (Platform.OS === 'ios') {
    // Null when the vendor id is briefly unavailable (e.g. before first unlock
    // after a restart). Failing is the only safe answer: a generated id would
    // be a new value on every launch, so the device would burn a device_limit
    // slot per re-link and a REVOKED device could re-link under a fresh id.
    const vendorId = await Application.getIosIdForVendorAsync();
    if (!vendorId) {
      throw new Error('El identificador del dispositivo no está disponible todavía.');
    }
    return vendorId;
  }

  return getGeneratedId();
}

export function getSuggestedDeviceName(): string {
  return Device.deviceName ?? Device.modelName ?? 'Dispositivo sin nombre';
}
