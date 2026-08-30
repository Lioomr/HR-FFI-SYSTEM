import { describe, expect, it } from '@jest/globals';

import type { ApiClient } from '@/services/api';

import {
  createDelegationRule,
  DELEGATION_CANDIDATES_PATH,
  DELEGATION_RULES_PATH,
  loadDelegationCandidates,
  loadDelegationRules,
  setDelegationRuleActive,
  validateDelegationDraft,
} from './delegations-api';

interface Call {
  path: string;
  method?: string;
  body?: unknown;
}

function fakeClient(payload: unknown) {
  const calls: Call[] = [];
  const client = {
    async request(path: string, options?: { method?: string; body?: unknown }) {
      calls.push({ path, method: options?.method, body: options?.body });
      return payload;
    },
  } as unknown as ApiClient;
  return { calls, client };
}

describe('delegation API contract', () => {
  it('parses the verified list and active-company candidate responses', async () => {
    const rules = fakeClient({
      items: [
        {
          id: 4,
          from_user: { id: 1, email: 'owner@example.test', full_name: 'Owner' },
          to_user: { id: 2, email: 'delegate@example.test', full_name: 'Delegate' },
          start_at: '2026-08-30T00:00:00Z',
          end_at: null,
          reason: 'Annual leave',
          is_active: true,
        },
      ],
    });
    const candidates = fakeClient([
      {
        id: 2,
        employee_id: 'EMP-2',
        full_name: 'Delegate',
        full_name_en: 'Delegate EN',
        full_name_ar: 'المفوَّض',
        can_delegate: true,
      },
    ]);

    await expect(loadDelegationRules(rules.client)).resolves.toMatchObject([
      { id: 4, fromUser: { fullName: 'Owner' }, toUser: { fullName: 'Delegate' }, isActive: true },
    ]);
    await expect(loadDelegationCandidates(candidates.client)).resolves.toMatchObject([
      { id: 2, employeeId: 'EMP-2', canDelegate: true },
    ]);
    expect(rules.calls).toEqual([
      { path: DELEGATION_RULES_PATH, method: undefined, body: undefined },
    ]);
    expect(candidates.calls).toEqual([
      { path: DELEGATION_CANDIDATES_PATH, method: undefined, body: undefined },
    ]);
  });

  it('creates a rule only for the signed-in user with serializer field names', async () => {
    const { calls, client } = fakeClient({
      id: 8,
      from_user: { id: 1 },
      to_user: { id: 2 },
      start_at: '2026-09-01T00:00:00Z',
      is_active: true,
    });

    await createDelegationRule(
      1,
      {
        toUserId: 2,
        startDate: '2026-09-01',
        endDate: '2026-09-03',
        reason: '  Coverage  ',
      },
      client,
    );

    expect(calls).toEqual([
      {
        path: DELEGATION_RULES_PATH,
        method: 'POST',
        body: {
          from_user_id: 1,
          to_user_id: 2,
          start_at: '2026-09-01T00:00:00Z',
          end_at: '2026-09-03T23:59:59Z',
          reason: 'Coverage',
          is_active: true,
        },
      },
    ]);
  });

  it('patches only the active state when changing an existing rule', async () => {
    const { calls, client } = fakeClient({ id: 8, from_user: {}, to_user: {}, is_active: false });
    await setDelegationRuleActive(8, false, client);
    expect(calls[0]).toEqual({
      path: `${DELEGATION_RULES_PATH}8/`,
      method: 'PATCH',
      body: { is_active: false },
    });
  });

  it('validates selection and the server-required date ordering before a request', () => {
    expect(
      validateDelegationDraft({ toUserId: null, startDate: '', endDate: '2026-09-01', reason: '' }),
    ).toMatchObject({
      toUserId: 'delegations.delegateRequired',
      startDate: 'delegations.startRequired',
    });
    expect(
      validateDelegationDraft({
        toUserId: 2,
        startDate: '2026-09-04',
        endDate: '2026-09-03',
        reason: '',
      }),
    ).toEqual({ endDate: 'delegations.endBeforeStart' });
  });
});
