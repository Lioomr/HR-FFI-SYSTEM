import { useLocales, type Locale } from 'expo-localization';
import { createContext, type PropsWithChildren, useContext, useMemo } from 'react';

import {
  createLocalization,
  type DeviceLocaleLike,
  type LocaleFactoryOptions,
  type Localization,
} from './localization';

const LocalizationContext = createContext<Localization | null>(null);

export interface LocalizationProviderProps extends PropsWithChildren {
  /** Injectable for tests and previews. Production follows the system/per-app locale. */
  locales?: readonly DeviceLocaleLike[];
  options?: LocaleFactoryOptions;
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

export function LocalizationProvider({ children, locales, options }: LocalizationProviderProps) {
  const systemLocales = useLocales();
  const deviceLocales = useMemo(() => toDeviceLocales(systemLocales), [systemLocales]);
  const resolvedLocales = locales ?? deviceLocales;
  const localization = useMemo(
    () => createLocalization(resolvedLocales, options),
    [options, resolvedLocales],
  );

  return (
    <LocalizationContext.Provider value={localization}>{children}</LocalizationContext.Provider>
  );
}

export function useLocalization(): Localization {
  const localization = useContext(LocalizationContext);

  if (!localization) {
    throw new Error('useLocalization must be used within LocalizationProvider');
  }

  return localization;
}

export const useI18n = useLocalization;
