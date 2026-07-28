import { I18n, type TranslateOptions } from 'i18n-js';

import { createDirectionHelpers, type DirectionHelpers, type LayoutDirection } from './direction';
import {
  arabicTranslations,
  englishTranslations,
  type TranslationDictionary,
  type TranslationKey,
} from './translations';

export const supportedLanguages = ['en', 'ar'] as const;
export type SupportedLanguage = (typeof supportedLanguages)[number];

export interface DeviceLocaleLike {
  currencyCode?: string | null;
  languageCode?: string | null;
  languageTag: string;
  regionCode?: string | null;
  textDirection?: LayoutDirection;
}

export interface Localization {
  currencyCode: string;
  direction: LayoutDirection;
  directionHelpers: DirectionHelpers;
  formatCurrency: (
    value: number,
    currencyCode?: string,
    options?: Omit<Intl.NumberFormatOptions, 'currency' | 'style'>,
  ) => string;
  formatDate: (value: Date | number | string, options?: Intl.DateTimeFormatOptions) => string;
  formatDateTime: (value: Date | number | string, options?: Intl.DateTimeFormatOptions) => string;
  formatNumber: (value: number, options?: Intl.NumberFormatOptions) => string;
  formatTime: (value: Date | number | string, options?: Intl.DateTimeFormatOptions) => string;
  isRTL: boolean;
  language: SupportedLanguage;
  localeTag: string;
  regionCode: string | null;
  t: (key: TranslationKey, values?: TranslateOptions) => string;
}

export interface LocaleFactoryOptions {
  defaultCurrencyCode?: string;
  defaultRegionCode?: string;
  timeZone?: string;
}

const DEFAULT_CURRENCY_CODE = 'EGP';

function languageFrom(locale: DeviceLocaleLike): string {
  return (locale.languageCode ?? locale.languageTag.split(/[-_]/u)[0] ?? '').toLowerCase();
}

function isSupportedLanguage(language: string): language is SupportedLanguage {
  return supportedLanguages.some((supported) => supported === language);
}

function regionFromTag(languageTag: string): string | null {
  const parts = languageTag.replace('_', '-').split('-');
  return (
    parts
      .find((part) => /^[A-Za-z]{2}$/u.test(part) && part.toLowerCase() !== parts[0]?.toLowerCase())
      ?.toUpperCase() ?? null
  );
}

function createLocaleTag(language: SupportedLanguage, regionCode: string | null): string {
  return regionCode ? `${language}-${regionCode.toUpperCase()}` : language;
}

function toDate(value: Date | number | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function nestDictionary(dictionary: TranslationDictionary): Record<string, unknown> {
  const nested: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(dictionary)) {
    const path = key.split('.');
    let target = nested;

    path.forEach((segment, index) => {
      if (index === path.length - 1) {
        target[segment] = value;
        return;
      }

      const next = target[segment];
      if (typeof next !== 'object' || next === null) {
        target[segment] = {};
      }
      target = target[segment] as Record<string, unknown>;
    });
  }

  return nested;
}

/** Pure, injectable locale factory. It never reads from or writes to storage. */
export function createLocalization(
  deviceLocales: readonly DeviceLocaleLike[],
  options: LocaleFactoryOptions = {},
): Localization {
  const preferredLocale = deviceLocales.find((locale) => isSupportedLanguage(languageFrom(locale)));
  const deviceLocale = preferredLocale ?? deviceLocales[0];
  const candidateLanguage = preferredLocale ? languageFrom(preferredLocale) : 'en';
  const language: SupportedLanguage = isSupportedLanguage(candidateLanguage)
    ? candidateLanguage
    : 'en';
  const regionCode =
    deviceLocale?.regionCode ??
    (deviceLocale ? regionFromTag(deviceLocale.languageTag) : null) ??
    options.defaultRegionCode ??
    null;
  const localeTag = createLocaleTag(language, regionCode);
  const currencyCode =
    deviceLocale?.currencyCode ?? options.defaultCurrencyCode ?? DEFAULT_CURRENCY_CODE;
  const isRTL = language === 'ar';
  const i18n = new I18n({
    en: nestDictionary(englishTranslations),
    ar: nestDictionary(arabicTranslations),
  });
  i18n.defaultLocale = 'en';
  i18n.enableFallback = true;
  i18n.locale = language;

  const withTimeZone = (formatOptions: Intl.DateTimeFormatOptions): Intl.DateTimeFormatOptions =>
    options.timeZone && !formatOptions.timeZone
      ? { ...formatOptions, timeZone: options.timeZone }
      : formatOptions;

  return {
    currencyCode,
    direction: isRTL ? 'rtl' : 'ltr',
    directionHelpers: createDirectionHelpers(isRTL),
    formatCurrency: (value, requestedCurrency = currencyCode, formatOptions = {}) =>
      new Intl.NumberFormat(localeTag, {
        ...formatOptions,
        currency: requestedCurrency,
        style: 'currency',
      }).format(value),
    formatDate: (value, formatOptions = { dateStyle: 'medium' }) =>
      new Intl.DateTimeFormat(localeTag, withTimeZone(formatOptions)).format(toDate(value)),
    formatDateTime: (value, formatOptions = { dateStyle: 'medium', timeStyle: 'short' }) =>
      new Intl.DateTimeFormat(localeTag, withTimeZone(formatOptions)).format(toDate(value)),
    formatNumber: (value, formatOptions) =>
      new Intl.NumberFormat(localeTag, formatOptions).format(value),
    formatTime: (value, formatOptions = { timeStyle: 'short' }) =>
      new Intl.DateTimeFormat(localeTag, withTimeZone(formatOptions)).format(toDate(value)),
    isRTL,
    language,
    localeTag,
    regionCode,
    t: (key, values) => i18n.t(key, values),
  };
}
