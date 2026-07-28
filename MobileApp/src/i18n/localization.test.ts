import { describe, expect, it } from '@jest/globals';

import { createDirectionHelpers, logicalMargin, logicalPadding } from './direction';
import { createLocalization } from './localization';
import { arabicTranslations, englishTranslations } from './translations';

const fixedDate = new Date('2026-07-20T13:45:00.000Z');

describe('createLocalization', () => {
  it('selects English and interpolates translated values', () => {
    const locale = createLocalization(
      [{ languageCode: 'en', languageTag: 'en-US', regionCode: 'US', currencyCode: 'USD' }],
      { timeZone: 'UTC' },
    );

    expect(locale.language).toBe('en');
    expect(locale.localeTag).toBe('en-US');
    expect(locale.direction).toBe('ltr');
    expect(locale.t('tabs.home')).toBe('Home');
    expect(locale.t('dashboard.greeting', { name: 'Sam' })).toBe('Hello, Sam');
  });

  it('selects Arabic and exposes RTL direction', () => {
    const locale = createLocalization([
      { languageCode: 'ar', languageTag: 'ar-EG', regionCode: 'EG', currencyCode: 'EGP' },
    ]);

    expect(locale.language).toBe('ar');
    expect(locale.localeTag).toBe('ar-EG');
    expect(locale.isRTL).toBe(true);
    expect(locale.directionHelpers.text).toEqual({ textAlign: 'right', writingDirection: 'rtl' });
    expect(locale.t('tabs.notifications')).toBe('الإشعارات');
  });

  it('uses the first supported device preference and falls back to English', () => {
    const supportedPreference = createLocalization([
      { languageCode: 'fr', languageTag: 'fr-FR', regionCode: 'FR', currencyCode: 'EUR' },
      { languageCode: 'ar', languageTag: 'ar-AE', regionCode: 'AE', currencyCode: 'AED' },
    ]);
    const fallback = createLocalization([
      { languageCode: 'fr', languageTag: 'fr-FR', regionCode: 'FR', currencyCode: 'EUR' },
    ]);

    expect(supportedPreference.language).toBe('ar');
    expect(supportedPreference.localeTag).toBe('ar-AE');
    expect(fallback.language).toBe('en');
    expect(fallback.localeTag).toBe('en-FR');
    expect(fallback.currencyCode).toBe('EUR');
    expect(fallback.t('common.retry')).toBe('Try again');
  });

  it('formats dates, times, numbers, and currency with device language and region', () => {
    const locale = createLocalization(
      [{ languageCode: 'ar', languageTag: 'ar-EG', regionCode: 'EG', currencyCode: 'EGP' }],
      { timeZone: 'UTC' },
    );

    expect(locale.formatDate(fixedDate)).toBe(
      new Intl.DateTimeFormat('ar-EG', { dateStyle: 'medium', timeZone: 'UTC' }).format(fixedDate),
    );
    expect(locale.formatTime(fixedDate)).toBe(
      new Intl.DateTimeFormat('ar-EG', { timeStyle: 'short', timeZone: 'UTC' }).format(fixedDate),
    );
    expect(locale.formatNumber(12345.6)).toBe(new Intl.NumberFormat('ar-EG').format(12345.6));
    expect(locale.formatCurrency(2500)).toBe(
      new Intl.NumberFormat('ar-EG', { currency: 'EGP', style: 'currency' }).format(2500),
    );
  });

  it('keeps English and Arabic dictionaries in exact key parity', () => {
    expect(Object.keys(arabicTranslations).sort()).toEqual(Object.keys(englishTranslations).sort());
  });
});

describe('logical direction helpers', () => {
  it('mirrors rows and directional icons for RTL', () => {
    const rtl = createDirectionHelpers(true);
    const ltr = createDirectionHelpers(false);

    expect(rtl.row).toEqual({ flexDirection: 'row-reverse' });
    expect(rtl.directionalIcon).toEqual({ transform: [{ scaleX: -1 }] });
    expect(ltr.row).toEqual({ flexDirection: 'row' });
    expect(ltr.directionalIcon).toEqual({ transform: [{ scaleX: 1 }] });
  });

  it('emits logical inline spacing instead of physical left/right spacing', () => {
    expect(logicalMargin({ inlineStart: 12, inlineEnd: 8 })).toEqual({
      marginBottom: undefined,
      marginEnd: 8,
      marginStart: 12,
      marginTop: undefined,
    });
    expect(logicalPadding({ blockStart: 4, inlineEnd: 16 })).toEqual({
      paddingBottom: undefined,
      paddingEnd: 16,
      paddingStart: undefined,
      paddingTop: 4,
    });
  });
});
