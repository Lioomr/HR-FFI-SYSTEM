import { describe, expect, it } from '@jest/globals';

import { arabicTranslations, englishTranslations, type TranslationKey } from './translations';

const englishKeys = Object.keys(englishTranslations) as TranslationKey[];
const arabicKeys = Object.keys(arabicTranslations) as TranslationKey[];

function placeholders(value: string): string[] {
  return [...value.matchAll(/%\{(\w+)\}/gu)].map((match) => match[1]).sort();
}

/** Arabic text must not silently fall back to English for any Gate 3 surface. */
const ARABIC_SCRIPT = /[؀-ۿ]/u;

describe('translation dictionaries', () => {
  it('covers every key in both languages', () => {
    expect(arabicKeys.sort()).toEqual([...englishKeys].sort());
  });

  it('keeps interpolation placeholders identical across languages', () => {
    for (const key of englishKeys) {
      expect(placeholders(arabicTranslations[key])).toEqual(placeholders(englishTranslations[key]));
    }
  });

  it('has no empty or untranslated Arabic string', () => {
    const withoutPlaceholders = (value: string) => value.replace(/%\{\w+\}/gu, '');

    for (const key of englishKeys) {
      const arabic = arabicTranslations[key];
      expect(arabic.trim().length).toBeGreaterThan(0);
      // Values that are only placeholders or punctuation legitimately match across languages.
      if (/[a-z]/iu.test(withoutPlaceholders(englishTranslations[key]))) {
        expect([key, ARABIC_SCRIPT.test(arabic)]).toEqual([key, true]);
      }
    }
  });

  it('translates every status, employment, payslip, and document enum the app can render', () => {
    const required: TranslationKey[] = [
      'attendanceStatus.PENDING_MGR',
      'attendanceStatus.PENDING_HR',
      'attendanceStatus.PENDING_CEO',
      'attendanceStatus.PENDING',
      'attendanceStatus.PRESENT',
      'attendanceStatus.ABSENT',
      'attendanceStatus.LATE',
      'attendanceStatus.REJECTED',
      'leaveStatus.submitted',
      'leaveStatus.pending_delegate',
      'leaveStatus.pending_manager',
      'leaveStatus.pending_hr',
      'leaveStatus.pending_ceo',
      'leaveStatus.pending_hr_completion',
      'leaveStatus.approved',
      'leaveStatus.rejected',
      'leaveStatus.cancelled',
      'employmentStatus.ACTIVE',
      'employmentStatus.SUSPENDED',
      'employmentStatus.TERMINATED',
      'employmentStatus.ON_LEAVE',
      'payslipStatus.PAID',
      'payslipStatus.COMPLETED',
      'payslipStatus.DRAFT',
      'payslipStatus.CANCELLED',
      'documentType.IQAMA',
      'documentType.PASSPORT',
      'documentType.VISA',
      'documentType.SAUDI_ID',
      'documentType.OTHER',
    ];

    for (const key of required) {
      expect(englishKeys).toContain(key);
    }
  });

  it('states file-download limitations honestly rather than implying success', () => {
    for (const key of [
      'payslips.downloadUnavailable',
      'documents.downloadUnavailable',
      'announcements.attachmentNotice',
    ] as TranslationKey[]) {
      expect(englishTranslations[key]).toMatch(/not enabled in this app version/u);
      expect(arabicTranslations[key]).toMatch(/غير مفعّل/u);
    }
  });

  it('never embeds a token, credential, or URL in user-facing copy', () => {
    for (const key of englishKeys) {
      for (const value of [englishTranslations[key], arabicTranslations[key]]) {
        expect(value).not.toMatch(/bearer|jwt|token|password=|https?:\/\//iu);
      }
    }
  });
});
