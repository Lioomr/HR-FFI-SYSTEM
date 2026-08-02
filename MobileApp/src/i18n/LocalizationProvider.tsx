import { useLocales, type Locale } from 'expo-localization';
import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react';

import {
  createLocalization,
  supportedLanguages,
  type DeviceLocaleLike,
  type LocaleFactoryOptions,
  type Localization,
  type SupportedLanguage,
} from './localization';

export interface LocalizationContextValue extends Localization {
  /** Switches the in-app language for this session only. Nothing is persisted. */
  setLanguage: (language: SupportedLanguage) => void;
  /** Clears the in-app override and follows the device/per-app language again. */
  useDeviceLanguage: () => void;
  availableLanguages: readonly SupportedLanguage[];
  isLanguageOverridden: boolean;
}

const LocalizationContext = createContext<LocalizationContextValue | null>(null);

export interface LocalizationProviderProps extends PropsWithChildren {
  /** Injectable for tests and previews. Production follows the system/per-app locale. */
  locales?: readonly DeviceLocaleLike[];
  options?: LocaleFactoryOptions;
  initialLanguage?: SupportedLanguage;
}

function toDeviceLocales(locales: readonly Locale[]): DeviceLocaleLike[] {
  return locales.map(({ currencyCode, languageCode, languageTag, regionCode, textDirection }) => ({
    currencyCode,
    languageCode,
    languageTag,
    regionCode,
    textDirection: textDirection ?? undefined,
  }));
}

export function LocalizationProvider({
  children,
  initialLanguage,
  locales,
  options,
}: LocalizationProviderProps) {
  const systemLocales = useLocales();
  const [override, setOverride] = useState<SupportedLanguage | null>(initialLanguage ?? null);
  const deviceLocales = useMemo(() => toDeviceLocales(systemLocales), [systemLocales]);
  const resolvedLocales = locales ?? deviceLocales;
  const resolvedOptions = useMemo<LocaleFactoryOptions>(
    () => ({ ...options, language: override ?? options?.language }),
    [options, override],
  );
  const localization = useMemo(
    () => createLocalization(resolvedLocales, resolvedOptions),
    [resolvedLocales, resolvedOptions],
  );

  const setLanguage = useCallback((language: SupportedLanguage) => {
    setOverride(supportedLanguages.includes(language) ? language : null);
  }, []);
  const useDeviceLanguage = useCallback(() => setOverride(null), []);

  const value = useMemo<LocalizationContextValue>(
    () => ({
      ...localization,
      availableLanguages: supportedLanguages,
      isLanguageOverridden: override !== null,
      setLanguage,
      useDeviceLanguage,
    }),
    [localization, override, setLanguage, useDeviceLanguage],
  );

  return <LocalizationContext.Provider value={value}>{children}</LocalizationContext.Provider>;
}

export function useLocalization(): LocalizationContextValue {
  const localization = useContext(LocalizationContext);

  if (!localization) {
    throw new Error('useLocalization must be used within LocalizationProvider');
  }

  return localization;
}

export const useI18n = useLocalization;
