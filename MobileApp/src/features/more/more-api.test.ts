import { describe, expect, it } from '@jest/globals';

import { ApiError, type ApiClient } from '@/services/api';

import {
  DOCUMENTS_PATH,
  PAYSLIPS_PATH,
  PROFILE_PATH,
  loadDocuments,
  loadPayslipDetail,
  loadPayslips,
  loadProfile,
  parseDocument,
  parsePayslipDetail,
  parseProfile,
} from './more-api';

interface Call {
  path: string;
}

function fakeClient(handler: (call: Call) => unknown): { client: ApiClient; calls: Call[] } {
  const calls: Call[] = [];
  const client = {
    async request(path: string) {
      const call = { path };
      calls.push(call);
      const result = handler(call);
      if (result instanceof Error) throw result;
      return result;
    },
  } as unknown as ApiClient;
  return { client, calls };
}

/** Mirrors the wide server serializer, including fields mobile must not project. */
const profilePayload = {
  id: 12,
  employee_id: 'FFI-0012',
  employee_number: 'E-0012',
  full_name: 'Nora Employee',
  email: 'employee@example.com',
  mobile: '0500000000',
  department: 'Operations',
  position: 'Engineer',
  manager_name: 'Sara Manager',
  hire_date: '2024-06-01',
  contract_expiry: '2027-06-01',
  employment_status: 'ACTIVE',
  company_name: 'FFI Egypt',
  nationality: 'Egyptian',
  basic_salary: '3500.00',
  total_salary: '4200.00',
  transportation_allowance: '300.00',
  passport_no: 'A1234567',
  passport: 'A1234567',
  national_id: '2999999999',
  date_of_birth: '1995-01-01',
  leave_balances: [{ leave_type_id: 1, remaining_days: '16.00' }],
};

describe('more contract', () => {
  it('uses only the verified self-service profile, document, and payslip paths', () => {
    expect(PROFILE_PATH).toBe('/api/employees/me/');
    expect(DOCUMENTS_PATH).toBe('/api/employees/me/documents/');
    expect(PAYSLIPS_PATH).toBe('/employee/payslips/');
  });

  it('resolves documents through the server-owned "me" lookup, never a client-held id', async () => {
    const { calls, client } = fakeClient(() => []);

    await loadDocuments(client);

    expect(calls[0].path).toBe('/api/employees/me/documents/');
    expect(calls[0].path).not.toMatch(/\/\d+\//u);
  });

  it('projects the profile without salary, allowance, or identity-document numbers', async () => {
    const { calls, client } = fakeClient(() => profilePayload);

    const profile = await loadProfile(client);

    expect(calls[0].path).toBe('/api/employees/me/');
    expect(Object.keys(profile).sort()).toEqual([
      'companyName',
      'contractExpiry',
      'department',
      'email',
      'employeeNumber',
      'employmentStatus',
      'fullName',
      'hireDate',
      'id',
      'managerName',
      'mobile',
      'nationality',
      'position',
    ]);

    const serialized = JSON.stringify(profile);
    for (const secret of ['3500', '4200', 'A1234567', '2999999999', '1995-01-01']) {
      expect(serialized).not.toContain(secret);
    }
  });

  it('falls back through the documented name and number aliases', () => {
    const profile = parseProfile({ full_name_en: 'Nora', employee_id: 'FFI-0012' });

    expect(profile.fullName).toBe('Nora');
    expect(profile.employeeNumber).toBe('FFI-0012');
  });

  it('reads the paginated owner payslip list and the full detail breakdown', async () => {
    const listPayload = {
      items: [
        {
          id: 5,
          year: 2026,
          month: 6,
          net_salary: '4200.00',
          payment_mode: 'Bank Transfer',
          status: 'PAID',
        },
      ],
      page: 1,
      page_size: 24,
      count: 1,
      total_pages: 1,
    };
    const detailPayload = {
      id: 5,
      year: 2026,
      month: 6,
      basic_salary: '3500.00',
      transportation_allowance: '300.00',
      accommodation_allowance: '200.00',
      telephone_allowance: '100.00',
      petrol_allowance: '50.00',
      other_allowance: '50.00',
      total_salary: '4200.00',
      total_deductions: '0.00',
      net_salary: '4200.00',
      payment_mode: 'Bank Transfer',
      status: 'PAID',
    };
    const { calls, client } = fakeClient((call) =>
      call.path.includes('?') ? listPayload : detailPayload,
    );

    const list = await loadPayslips(client, 24);
    const detail = await loadPayslipDetail(5, client);

    expect(calls.map((call) => call.path)).toEqual([
      '/employee/payslips/?page=1&page_size=24',
      '/employee/payslips/5/',
    ]);
    expect(list[0]).toEqual({
      id: 5,
      year: 2026,
      month: 6,
      netSalary: 4200,
      paymentMode: 'Bank Transfer',
      status: 'PAID',
    });
    expect(detail.basicSalary).toBe(3500);
    expect(detail.totalDeductions).toBe(0);
  });

  it('rejects a payslip list that does not match the paginated contract', async () => {
    const { client } = fakeClient(() => ({ results: [], count: 0 }));

    await expect(loadPayslips(client)).rejects.toBeInstanceOf(ApiError);
  });

  it('propagates the role rejection payslips return for non-employee accounts', async () => {
    const { client } = fakeClient(() => new ApiError('forbidden', 403));

    await expect(loadPayslips(client)).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('maps document metadata and never a file path or download URL', () => {
    const document = parseDocument({
      id: 3,
      document_type: 'IQAMA',
      display_name: 'Iqama',
      original_filename: 'iqama.pdf',
      exit_before: '2027-01-01',
      created_at: '2026-01-01T00:00:00Z',
      file: '/private_uploads/employee/3/iqama.pdf',
      extracted_fields: { visa_number: '123' },
    });

    expect(Object.keys(document).sort()).toEqual([
      'createdAt',
      'displayName',
      'documentType',
      'expiresAt',
      'id',
      'originalFilename',
    ]);
    expect(JSON.stringify(document)).not.toContain('private_uploads');
  });

  it('parses decimal strings from the server into finite numbers', () => {
    const detail = parsePayslipDetail({ net_salary: '1234.56', total_deductions: 'not-a-number' });

    expect(detail.netSalary).toBe(1234.56);
    expect(detail.totalDeductions).toBeNull();
  });
});
