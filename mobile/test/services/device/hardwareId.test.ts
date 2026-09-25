jest.mock('expo-application', () => ({
  getAndroidId: jest.fn(),
  getIosIdForVendorAsync: jest.fn(),
}));
jest.mock('expo-device', () => ({ deviceName: null, modelName: null }));

import { Platform } from 'react-native';
import * as Application from 'expo-application';
import * as Device from 'expo-device';
import { getHardwareId, getSuggestedDeviceName } from '../../../src/services/device/hardwareId';

describe('getHardwareId', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('uses the Android id on Android', async () => {
    Platform.OS = 'android';
    (Application.getAndroidId as jest.Mock).mockReturnValue('android-id-123');

    await expect(getHardwareId()).resolves.toBe('android-id-123');
  });

  it('uses the vendor id on iOS', async () => {
    Platform.OS = 'ios';
    (Application.getIosIdForVendorAsync as jest.Mock).mockResolvedValue('ios-vendor-456');

    await expect(getHardwareId()).resolves.toBe('ios-vendor-456');
  });

  it('falls back to a generated id on iOS when the vendor id is unavailable', async () => {
    Platform.OS = 'ios';
    (Application.getIosIdForVendorAsync as jest.Mock).mockResolvedValue(null);

    const id = await getHardwareId();
    expect(id).toMatch(/^web-/);
  });

  it('returns a stable generated id on web across calls', async () => {
    Platform.OS = 'web';

    const first = await getHardwareId();
    const second = await getHardwareId();
    expect(first).toBe(second);
    expect(first).toMatch(/^web-/);
  });
});

describe('getSuggestedDeviceName', () => {
  it('prefers the device name over the model name', () => {
    (Device as { deviceName: string | null }).deviceName = 'Telefono de Maria';
    (Device as { modelName: string | null }).modelName = 'Pixel 8';

    expect(getSuggestedDeviceName()).toBe('Telefono de Maria');
  });

  it('falls back to the model name, then to a generic label', () => {
    (Device as { deviceName: string | null }).deviceName = null;
    (Device as { modelName: string | null }).modelName = 'Pixel 8';
    expect(getSuggestedDeviceName()).toBe('Pixel 8');

    (Device as { modelName: string | null }).modelName = null;
    expect(getSuggestedDeviceName()).toBe('Dispositivo sin nombre');
  });
});
