import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { parseEnvironment } from './environment';

const appRoot = join(__dirname, '..', '..');
const appConfigSource = readFileSync(join(appRoot, 'app.config.ts'), 'utf8');
interface EasProfile {
  environment?: string;
  env?: Record<string, string>;
  extends?: string;
  ios?: { simulator?: boolean };
}

const easConfig = JSON.parse(readFileSync(join(appRoot, 'eas.json'), 'utf8')) as {
  build: Record<string, EasProfile>;
};

function resolveProfile(profileName: string, resolving = new Set<string>()): EasProfile {
  if (resolving.has(profileName)) throw new Error(`Circular EAS profile: ${profileName}`);
  const profile = easConfig.build[profileName];
  if (!profile) throw new Error(`Unknown EAS profile: ${profileName}`);
  if (!profile.extends) return profile;

  const parent = resolveProfile(profile.extends, new Set(resolving).add(profileName));
  return {
    ...parent,
    ...profile,
    env: { ...parent.env, ...profile.env },
    ios: { ...parent.ios, ...profile.ios },
  };
}

describe('EAS iOS readiness configuration', () => {
  it('pins the EAS project and iOS application identity', () => {
    expect(appConfigSource).toContain("slug: 'ffi-hr-employee'");
    expect(appConfigSource).not.toContain("slug: isTestVariant ? 'ffi-hr-employee-test'");
    expect(appConfigSource).toContain("'com.ffihr.employee'");
    expect(appConfigSource).toContain("'com.ffihr.employee.test'");
    expect(appConfigSource).toContain("'ffihr'");
    expect(appConfigSource).toContain("'ffihr-test'");

    const projectId = appConfigSource.match(/projectId:\s*'([^']+)'/u)?.[1];
    expect(projectId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu,
    );
  });

  it('maps every EAS profile to an explicit environment and forbids API fallback', () => {
    for (const [profile, environment] of [
      ['development', 'development'],
      ['ios-simulator', 'development'],
      ['test', 'preview'],
      ['preview', 'preview'],
      ['production', 'production'],
    ] as const) {
      expect(easConfig.build[profile]?.environment).toBe(environment);
    }

    expect(easConfig.build.development?.env?.FFI_REQUIRE_EXPLICIT_API_ORIGIN).toBe('true');
    expect(easConfig.build.test?.env?.FFI_APP_ENV).toBe('test');
    expect(easConfig.build.test?.env?.FFI_REQUIRE_EXPLICIT_API_ORIGIN).toBe('true');
    expect(easConfig.build.test?.env?.EXPO_PUBLIC_API_BASE_URL).toBe('https://api.asecopro.com');
    expect(easConfig.build.preview?.env?.FFI_REQUIRE_EXPLICIT_API_ORIGIN).toBe('true');
    expect(easConfig.build.production?.env?.FFI_REQUIRE_EXPLICIT_API_ORIGIN).toBe('true');
    expect(easConfig.build['ios-simulator']).toMatchObject({
      extends: 'development',
      ios: { simulator: true },
    });
    expect(appConfigSource).toContain('FFI_REQUIRE_EXPLICIT_API_ORIGIN');
  });

  it('makes every EAS profile resolve HTTPS or fail closed', () => {
    for (const profileName of Object.keys(easConfig.build)) {
      const profile = resolveProfile(profileName);
      expect(profile.env?.FFI_REQUIRE_EXPLICIT_API_ORIGIN).toBe('true');

      const options = { isDevelopment: false };
      expect(() => parseEnvironment(undefined, options)).toThrow('required outside development');
      expect(() => parseEnvironment('http://localhost:8000', options)).toThrow(
        'must use HTTPS outside development',
      );
      expect(parseEnvironment('https://hr.example.com', options).apiBaseUrl).toBe(
        'https://hr.example.com',
      );
    }
  });
});
