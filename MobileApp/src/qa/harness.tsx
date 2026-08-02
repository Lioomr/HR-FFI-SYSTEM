import { render, type RenderOptions } from '@testing-library/react-native';
import type { PropsWithChildren, ReactElement } from 'react';

import type { AuthUser } from '@/auth';
import { LocalizationProvider, type SupportedLanguage } from '@/i18n';
import { AuthProvider, type AuthService } from '@/providers';

/**
 * Test-only provider harness. It lives under `src/qa/` so the Gate 2 production source
 * scan continues to exclude it, and it wires the real localization and auth providers so
 * language, RTL, and session behaviour are exercised rather than mocked away.
 */

export const testUser: AuthUser = {
  accessible_organizations: [{ id: 7, name: 'FFI Egypt' }],
  default_organization_id: 7,
  email: 'employee@example.com',
  full_name: 'Nora Employee',
  has_all_company_access: false,
  id: 'user-1',
  role: 'Employee',
};

export function stubAuthService(overrides: Partial<AuthService> = {}): AuthService {
  return {
    changePassword: async () => undefined,
    login: async () => testUser,
    logout: async () => undefined,
    restoreSession: async () => testUser,
    selectActiveCompany: () => undefined,
    ...overrides,
  };
}

const LOCALES: Readonly<Record<SupportedLanguage, { languageCode: string; languageTag: string }>> =
  Object.freeze({
    en: { languageCode: 'en', languageTag: 'en-US' },
    ar: { languageCode: 'ar', languageTag: 'ar-SA' },
  });

export interface HarnessOptions extends Omit<RenderOptions, 'wrapper'> {
  language?: SupportedLanguage;
  authService?: AuthService;
}

export function providerWrapper({
  authService = stubAuthService(),
  language = 'en',
}: Pick<HarnessOptions, 'authService' | 'language'> = {}) {
  return function Wrapper({ children }: PropsWithChildren) {
    return (
      <LocalizationProvider initialLanguage={language} locales={[LOCALES[language]]}>
        <AuthProvider client={authService}>{children}</AuthProvider>
      </LocalizationProvider>
    );
  };
}

/** Mirrors the async `render` contract of React Native Testing Library 14. */
export function renderWithProviders(ui: ReactElement, options: HarnessOptions = {}) {
  const { authService, language, ...renderOptions } = options;
  return render(ui, { ...renderOptions, wrapper: providerWrapper({ authService, language }) });
}

export type RenderedScreen = Awaited<ReturnType<typeof renderWithProviders>>;
