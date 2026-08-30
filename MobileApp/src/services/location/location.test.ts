import { describe, expect, it, jest } from '@jest/globals';

import { captureCurrentReading, toGeoReading, type LocationProvider } from './location';

function provider(overrides: Partial<LocationProvider> = {}): LocationProvider {
  return {
    requestForegroundPermission: async () => ({ granted: true }),
    getCurrentPosition: async () => ({
      coords: { latitude: 24.7136, longitude: 46.6753, accuracy: 12.5 },
    }),
    ...overrides,
  };
}

describe('geo reading formatting', () => {
  it('emits exactly six decimal degrees and two decimal metres', () => {
    expect(toGeoReading({ latitude: 24.7136, longitude: 46.6753, accuracy: 12.5 })).toEqual({
      latitude: '24.713600',
      longitude: '46.675300',
      accuracyMeters: '12.50',
    });
  });

  it('keeps the sign and pads short southern and western coordinates', () => {
    expect(toGeoReading({ latitude: -1.5, longitude: -0.25, accuracy: 0 })).toEqual({
      latitude: '-1.500000',
      longitude: '-0.250000',
      accuracyMeters: '0.00',
    });
  });

  it('rounds rather than truncates a longer device fix', () => {
    expect(toGeoReading({ latitude: 24.7136004, longitude: 46.6753006, accuracy: 8.128 })).toEqual({
      latitude: '24.713600',
      longitude: '46.675301',
      accuracyMeters: '8.13',
    });
  });

  it('refuses a fix the platform could not express as a real number', () => {
    expect(toGeoReading({ latitude: Number.NaN, longitude: 46.6753, accuracy: 10 })).toBeNull();
    expect(toGeoReading({ latitude: 24.7136, longitude: Infinity, accuracy: 10 })).toBeNull();
  });

  it('refuses a fix that carries no accuracy radius, rather than inventing one', () => {
    expect(toGeoReading({ latitude: 24.7136, longitude: 46.6753, accuracy: null })).toBeNull();
  });
});

describe('capturing a reading before an attendance action', () => {
  it('returns a formatted reading once foreground permission is granted', async () => {
    expect(await captureCurrentReading(provider())).toEqual({
      status: 'ready',
      reading: { latitude: '24.713600', longitude: '46.675300', accuracyMeters: '12.50' },
    });
  });

  it('reports permission denial without ever asking the platform for a fix', async () => {
    const getCurrentPosition = jest.fn(provider().getCurrentPosition);
    const outcome = await captureCurrentReading(
      provider({
        requestForegroundPermission: async () => ({ granted: false }),
        getCurrentPosition,
      }),
    );

    expect(outcome).toEqual({ status: 'failed', reason: 'permission-denied' });
    expect(getCurrentPosition).not.toHaveBeenCalled();
  });

  it('reports the location as unavailable when the platform cannot produce a fix', async () => {
    const outcome = await captureCurrentReading(
      provider({
        getCurrentPosition: async () => {
          throw new Error('kCLErrorDomain error 0 at /Users/someone/app/Location.swift');
        },
      }),
    );

    expect(outcome).toEqual({ status: 'failed', reason: 'unavailable' });
  });

  it('reports unavailable when the permission request itself throws', async () => {
    const outcome = await captureCurrentReading(
      provider({
        requestForegroundPermission: async () => {
          throw new Error('location services are disabled');
        },
      }),
    );

    expect(outcome).toEqual({ status: 'failed', reason: 'unavailable' });
  });

  it('treats a fix with no accuracy radius as unavailable rather than sending it', async () => {
    const outcome = await captureCurrentReading(
      provider({
        getCurrentPosition: async () => ({
          coords: { latitude: 24.7136, longitude: 46.6753, accuracy: null },
        }),
      }),
    );

    expect(outcome).toEqual({ status: 'failed', reason: 'unavailable' });
  });

  it('retains no native error text in either failure outcome', async () => {
    const outcome = await captureCurrentReading(
      provider({
        getCurrentPosition: async () => {
          throw new Error('Bearer abc.def.ghi https://internal.example.com/trace');
        },
      }),
    );

    expect(JSON.stringify(outcome)).not.toMatch(/Bearer|https?:\/\/|\.swift/u);
  });
});
