/**
 * Typed narrowing of the untyped `AuthUser.role` wire field.
 *
 * The backend resolves the role from Django groups in
 * `Backend/core/permissions.py::get_role`, with the precedence
 * `SystemAdmin > CFO > HRManager > Manager > CEO > Employee` and `Employee` as
 * the default. This module mirrors that vocabulary and keeps every role-based
 * decision in one place; the wire contract itself stays a plain `string`.
 */
export const ROLES = Object.freeze([
  'SystemAdmin',
  'CFO',
  'HRManager',
  'Manager',
  'CEO',
  'Employee',
] as const);

export type Role = (typeof ROLES)[number];

/**
 * `'Manager'` exists in the union only for completeness with `get_role()`.
 * Manager-ness is NOT a peer role in this system: `IsManager` ignores the
 * `Manager` Django group entirely and checks direct/delegated reports via
 * `has_manager_access(user)`. Any future manager-capability feature must call
 * `GET /api/employees/manager/access/` — never compare `role === 'Manager'`.
 */

/** Fail-closed: anything unrecognized narrows to the backend's own default. */
export function normalizeRole(raw: string | undefined | null): Role {
  const found = ROLES.find((candidate) => candidate === raw);
  return found ?? 'Employee';
}

/** CEO/CFO/SystemAdmin are approvers in this app, not self-service employees. */
export function isEmployeeSelfServiceRole(role: Role): boolean {
  return role !== 'CEO' && role !== 'CFO' && role !== 'SystemAdmin';
}

export function isLeaveHrApprover(role: Role): boolean {
  return role === 'HRManager' || role === 'SystemAdmin';
}

export function isLeaveCeoApprover(role: Role): boolean {
  return role === 'CEO';
}

export function hasAnyApprovalAccess(role: Role): boolean {
  return (
    role === 'HRManager' ||
    role === 'CEO' ||
    role === 'CFO' ||
    role === 'SystemAdmin' ||
    role === 'Manager'
  );
}
