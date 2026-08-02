import type { LocalizationContextValue } from '@/i18n';

type Localization = Pick<
  LocalizationContextValue,
  'formatCurrency' | 'formatDate' | 'formatDateTime' | 'formatNumber' | 'formatTime' | 't'
>;

/**
 * Locale formatters never throw into the render tree: a malformed server value falls
 * back to the localized "not available" placeholder instead of blanking a screen.
 */
export function safeFormat(
  value: string | number | null | undefined,
  format: (input: string | number) => string,
  fallback: string,
): string {
  if (value === null || value === undefined || value === '') return fallback;
  try {
    const formatted = format(value);
    return formatted && formatted !== 'Invalid Date' ? formatted : fallback;
  } catch {
    return fallback;
  }
}

export function formatDateValue(localization: Localization, value: string | null): string {
  const fallback = localization.t('common.notAvailable');
  return safeFormat(value, (input) => localization.formatDate(input), fallback);
}

export function formatTimeValue(localization: Localization, value: string | null): string {
  const fallback = localization.t('common.dash');
  return safeFormat(value, (input) => localization.formatTime(input), fallback);
}

export function formatDateTimeValue(localization: Localization, value: string | null): string {
  const fallback = localization.t('common.notAvailable');
  return safeFormat(value, (input) => localization.formatDateTime(input), fallback);
}

export function formatNumberValue(localization: Localization, value: number | null): string {
  const fallback = localization.t('common.notAvailable');
  return safeFormat(value, (input) => localization.formatNumber(Number(input)), fallback);
}

export function formatCurrencyValue(localization: Localization, value: number | null): string {
  const fallback = localization.t('common.notAvailable');
  return safeFormat(value, (input) => localization.formatCurrency(Number(input)), fallback);
}

/**
 * `i18n-js` interpolates the raw JavaScript number, so the count is re-inserted with the
 * locale-aware numeral system (for example Arabic-Indic digits) after translation.
 */
export function localizedCount(
  localization: Localization,
  key: Parameters<Localization['t']>[0],
  count: number,
): string {
  const translated = localization.t(key, { count });
  return translated.replace(String(count), localization.formatNumber(count));
}
