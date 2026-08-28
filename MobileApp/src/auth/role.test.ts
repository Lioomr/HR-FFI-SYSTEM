import { describe, expect, it } from '@jest/globals';

import {
  hasAnyApprovalAccess,
  isEmployeeSelfServiceRole,
  isLeaveCeoApprover,
  isLeaveHrApprover,
  normalizeRole,
  ROLES,
} from './role';

describe('normalizeRole', () => {
  it('keeps every known backend role', () => {
    for (const role of ROLES) {
      expect(normalizeRole(role)).toBe(role);
    }
  });

  it('fails closed to Employee for unknown, empty, or missing values', () => {
    expect(normalizeRole('Administrator')).toBe('Employee');
    expect(normalizeRole('hrmanager')).toBe('Employee');
    expect(normalizeRole('')).toBe('Employee');
    expect(normalizeRole(undefined)).toBe('Employee');
    expect(normalizeRole(null)).toBe('Employee');
  });
});

describe('role gates', () => {
  it('keeps self-service for everyone except CEO, CFO, and SystemAdmin', () => {
    expect(isEmployeeSelfServiceRole('Employee')).toBe(true);
    expect(isEmployeeSelfServiceRole('HRManager')).toBe(true);
    expect(isEmployeeSelfServiceRole('Manager')).toBe(true);
    expect(isEmployeeSelfServiceRole('CEO')).toBe(false);
    expect(isEmployeeSelfServiceRole('CFO')).toBe(false);
    expect(isEmployeeSelfServiceRole('SystemAdmin')).toBe(false);
  });

  it('scopes the leave approver gates to their stages', () => {
    expect(isLeaveHrApprover('HRManager')).toBe(true);
    expect(isLeaveHrApprover('SystemAdmin')).toBe(true);
    expect(isLeaveHrApprover('CEO')).toBe(false);
    expect(isLeaveCeoApprover('CEO')).toBe(true);
    expect(isLeaveCeoApprover('HRManager')).toBe(false);
  });

  it('grants approvals navigation to approver roles only', () => {
    expect(ROLES.filter(hasAnyApprovalAccess)).toEqual([
      'SystemAdmin',
      'CFO',
      'HRManager',
      'Manager',
      'CEO',
    ]);
  });
});
