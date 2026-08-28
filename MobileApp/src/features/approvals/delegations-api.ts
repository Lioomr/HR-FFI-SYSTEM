import {
  apiClient,
  booleanOrNull,
  identifierOrNull,
  record,
  stringOrNull,
  type ApiClient,
} from '@/services/api';
import type { TranslationKey } from '@/i18n';

import type { DelegationCandidate, DelegationDraft, DelegationRule } from './types';

export const DELEGATION_RULES_PATH = '/api/core/workflow/delegations/' as const;
export const DELEGATION_CANDIDATES_PATH = '/api/employees/delegation-candidates/' as const;

function parseUser(value: unknown) {
  const item = record(value);
  return {
    id: identifierOrNull(item.id),
    email: stringOrNull(item.email),
    fullName: stringOrNull(item.full_name),
  };
}

export function parseDelegationRule(value: unknown): DelegationRule {
  const item = record(value);
  return {
    id: identifierOrNull(item.id),
    fromUser: parseUser(item.from_user),
    toUser: parseUser(item.to_user),
    startAt: stringOrNull(item.start_at),
    endAt: stringOrNull(item.end_at),
    reason: stringOrNull(item.reason),
    isActive: booleanOrNull(item.is_active) ?? false,
  };
}

export function parseDelegationCandidate(value: unknown): DelegationCandidate {
  const item = record(value);
  return {
    id: identifierOrNull(item.id),
    employeeId: stringOrNull(item.employee_id),
    fullName: stringOrNull(item.full_name),
    fullNameEn: stringOrNull(item.full_name_en),
    fullNameAr: stringOrNull(item.full_name_ar),
    canDelegate: booleanOrNull(item.can_delegate) ?? false,
  };
}

export async function loadDelegationRules(
  client: ApiClient = apiClient,
): Promise<DelegationRule[]> {
  const payload = record(await client.request<unknown>(DELEGATION_RULES_PATH));
  const data = record(payload.data ?? payload);
  return Array.isArray(data.items) ? data.items.map(parseDelegationRule) : [];
}

/** This server-side candidate list is active-company scoped and excludes the signed-in user. */
export async function loadDelegationCandidates(
  client: ApiClient = apiClient,
): Promise<DelegationCandidate[]> {
  const payload = await client.request<unknown>(DELEGATION_CANDIDATES_PATH);
  const data = record(payload).data ?? payload;
  return Array.isArray(data) ? data.map(parseDelegationCandidate) : [];
}

function asDateTime(date: string, endOfDay = false): string {
  return `${date}T${endOfDay ? '23:59:59' : '00:00:00'}Z`;
}

export function validateDelegationDraft(
  draft: DelegationDraft,
): Partial<Record<keyof DelegationDraft, TranslationKey>> {
  const errors: Partial<Record<keyof DelegationDraft, TranslationKey>> = {};
  if (draft.toUserId === null) errors.toUserId = 'delegations.delegateRequired';
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(draft.startDate)) errors.startDate = 'delegations.startRequired';
  if (draft.endDate && !/^\d{4}-\d{2}-\d{2}$/u.test(draft.endDate)) {
    errors.endDate = 'delegations.endInvalid';
  }
  if (draft.startDate && draft.endDate && draft.endDate < draft.startDate) {
    errors.endDate = 'delegations.endBeforeStart';
  }
  return errors;
}

export async function createDelegationRule(
  fromUserId: number | string,
  draft: DelegationDraft,
  client: ApiClient = apiClient,
): Promise<DelegationRule> {
  const payload = await client.request<unknown>(DELEGATION_RULES_PATH, {
    method: 'POST',
    body: {
      from_user_id: fromUserId,
      to_user_id: draft.toUserId,
      start_at: asDateTime(draft.startDate),
      end_at: draft.endDate ? asDateTime(draft.endDate, true) : null,
      reason: draft.reason.trim(),
      is_active: true,
    },
  });
  return parseDelegationRule(record(payload).data ?? payload);
}

export async function setDelegationRuleActive(
  ruleId: number | string,
  isActive: boolean,
  client: ApiClient = apiClient,
): Promise<DelegationRule> {
  const path = `${DELEGATION_RULES_PATH}${encodeURIComponent(String(ruleId))}/` as `/${string}`;
  const payload = await client.request<unknown>(path, {
    method: 'PATCH',
    body: { is_active: isActive },
  });
  return parseDelegationRule(record(payload).data ?? payload);
}
