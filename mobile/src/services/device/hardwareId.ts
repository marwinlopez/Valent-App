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
    // Returns null when the vendor id is briefly unavailable (e.g. before first
    // unlock after a restart); a generated id keeps linking usable rather than
    // failing outright, and a re-link later simply updates the same row.
    const vendorId = await Application.getIosIdForVendorAsync();
    return vendorId ?? getGeneratedId();
  }

  return getGeneratedId();
}

export function getSuggestedDeviceName(): string {
  return Device.deviceName ?? Device.modelName ?? 'Dispositivo sin nombre';
}
