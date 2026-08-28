import { describe, expect, it } from '@jest/globals';

import { tabsForRole } from '@/app/(protected)/(tabs)/_layout';

const names = (role: string | undefined | null) => tabsForRole(role).map((tab) => tab.name);

describe('tabsForRole', () => {
  it('keeps the five self-service tabs for employees', () => {
    expect(names('Employee')).toEqual(['home', 'attendance', 'leave', 'notifications', 'more']);
  });

  it('falls back to the employee shell for an unknown or missing role', () => {
    expect(names(undefined)).toEqual(names('Employee'));
    expect(names('Wizard')).toEqual(names('Employee'));
  });

  it('gives HR every employee tab plus approvals', () => {
    expect(names('HRManager')).toEqual([
      'home',
      'attendance',
      'leave',
      'approvals',
      'notifications',
      'more',
    ]);
  });

  it('gives managers an approvals tab for their attendance-correction stage', () => {
    expect(names('Manager')).toEqual([
      'home',
      'attendance',
      'leave',
      'approvals',
      'notifications',
      'more',
    ]);
  });

  it('gives approver-only roles approvals, notifications, and more', () => {
    for (const role of ['CEO', 'CFO', 'SystemAdmin']) {
      expect(names(role)).toEqual(['approvals', 'notifications', 'more']);
    }
  });
});
