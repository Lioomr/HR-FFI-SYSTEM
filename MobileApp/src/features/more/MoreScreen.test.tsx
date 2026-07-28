import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, waitFor } from '@testing-library/react-native';

import { renderWithProviders, stubAuthService } from '@/qa/harness';
import { ApiError } from '@/services/api';

import { MoreScreen } from './MoreScreen';
import type { EmployeeDocumentSummary, EmployeeProfileSummary, PayslipSummary } from './types';

const mockPush = jest.fn();
const mockLoadProfile = jest.fn<() => Promise<EmployeeProfileSummary>>();
const mockLoadPayslips = jest.fn<() => Promise<PayslipSummary[]>>();
const mockLoadDocuments = jest.fn<() => Promise<EmployeeDocumentSummary[]>>();

jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush, back: jest.fn() }) }));
jest.mock('./more-api', () => {
  const actual = jest.requireActual<typeof import('./more-api')>('./more-api');
  return {
    ...actual,
    loadProfile: () => mockLoadProfile(),
    loadPayslips: () => mockLoadPayslips(),
    loadPayslipDetail: async () => ({
      id: 5,
      year: 2026,
      month: 6,
      netSalary: 4200,
      paymentMode: 'Bank Transfer',
      status: 'PAID',
      basicSalary: 3500,
      transportationAllowance: 300,
      accommodationAllowance: 200,
      telephoneAllowance: 100,
      petrolAllowance: 50,
      otherAllowance: 50,
      totalSalary: 4200,
      totalDeductions: 0,
    }),
    loadDocuments: () => mockLoadDocuments(),
  };
});

const profile: EmployeeProfileSummary = {
  id: 12,
  fullName: 'Nora Employee',
  employeeNumber: 'E-0012',
  email: 'employee@example.com',
  mobile: '0500000000',
  department: 'Operations',
  position: 'Engineer',
  managerName: 'Sara Manager',
  hireDate: '2024-06-01',
  contractExpiry: '2027-06-01',
  employmentStatus: 'ACTIVE',
  companyName: 'FFI Egypt',
  nationality: 'Egyptian',
};

const payslips: PayslipSummary[] = [
  { id: 5, year: 2026, month: 6, netSalary: 4200, paymentMode: 'Bank Transfer', status: 'PAID' },
];

const documents: EmployeeDocumentSummary[] = [
  {
    id: 3,
    documentType: 'IQAMA',
    displayName: 'Iqama',
    originalFilename: 'iqama.pdf',
    expiresAt: '2027-01-01',
    createdAt: '2026-01-01T00:00:00Z',
  },
];

describe('MoreScreen', () => {
  beforeEach(() => {
    mockPush.mockReset();
    mockLoadProfile.mockReset();
    mockLoadPayslips.mockReset();
    mockLoadDocuments.mockReset();
    mockLoadProfile.mockResolvedValue(profile);
    mockLoadPayslips.mockResolvedValue(payslips);
    mockLoadDocuments.mockResolvedValue(documents);
  });

  it('fetches nothing sensitive until the employee opens a section', async () => {
    const view = await renderWithProviders(<MoreScreen />);

    expect(await view.findByText('More')).toBeTruthy();
    expect(mockLoadProfile).not.toHaveBeenCalled();
    expect(mockLoadPayslips).not.toHaveBeenCalled();
    expect(mockLoadDocuments).not.toHaveBeenCalled();
  });

  it('loads the profile on demand and discards it when the sheet is closed', async () => {
    const view = await renderWithProviders(<MoreScreen />);

    await fireEvent.press(await view.findByTestId('more-profile'));
    expect(await view.findByTestId('profile-sheet')).toBeTruthy();
    await waitFor(() => expect(mockLoadProfile).toHaveBeenCalledTimes(1));
    expect(await view.findByText('Sara Manager')).toBeTruthy();
    expect(view.getByText('Active')).toBeTruthy();

    await fireEvent.press(view.getAllByRole('button', { name: 'Close' })[0]);

    await waitFor(() => expect(view.queryByTestId('profile-sheet')).toBeNull());
    expect(view.queryByText('Sara Manager')).toBeNull();
  });

  it('opens a payslip breakdown and states the download limitation honestly', async () => {
    const view = await renderWithProviders(<MoreScreen />);

    await fireEvent.press(await view.findByTestId('more-payslips'));
    await fireEvent.press(await view.findByTestId('payslip-5'));

    expect(await view.findByTestId('payslip-detail')).toBeTruthy();
    expect(await view.findByText('Basic salary')).toBeTruthy();
    expect(view.getByTestId('payslip-download-notice')).toBeTruthy();
  });

  it('renders the generic access state when payslips reject a non-employee role', async () => {
    mockLoadPayslips.mockRejectedValue(new ApiError('forbidden', 403));
    const view = await renderWithProviders(<MoreScreen />);

    await fireEvent.press(await view.findByTestId('more-payslips'));

    expect(await view.findByText('Access unavailable')).toBeTruthy();
    expect(view.queryByText(/403|Forbidden|IsEmployeeOnly/iu)).toBeNull();
  });

  it('lists documents as metadata only and never offers an in-app file download', async () => {
    const view = await renderWithProviders(<MoreScreen />);

    await fireEvent.press(await view.findByTestId('more-documents'));
    await fireEvent.press(await view.findByTestId('document-3'));

    expect(await view.findByTestId('document-detail')).toBeTruthy();
    expect(view.getByTestId('document-download-notice')).toBeTruthy();
    expect(view.queryByText(/download the file now|open file/iu)).toBeNull();
  });

  it('shows the documents empty state', async () => {
    mockLoadDocuments.mockResolvedValue([]);
    const view = await renderWithProviders(<MoreScreen />);

    await fireEvent.press(await view.findByTestId('more-documents'));

    expect(await view.findByText('No documents are available.')).toBeTruthy();
  });

  it('switches the whole session to Arabic and marks the selected option accessibly', async () => {
    const view = await renderWithProviders(<MoreScreen />);

    await fireEvent.press(await view.findByTestId('language-ar'));

    expect(await view.findByText('المزيد')).toBeTruthy();
    expect(view.getByTestId('language-ar').props.accessibilityState.selected).toBe(true);
    expect(view.getByTestId('language-en').props.accessibilityState.selected).toBe(false);
    expect(view.queryByText('More')).toBeNull();
  });

  it('routes to the change-password screen without any parameter', async () => {
    const view = await renderWithProviders(<MoreScreen />);

    await fireEvent.press(await view.findByTestId('more-change-password'));

    expect(mockPush).toHaveBeenCalledWith('/change-password');
    expect(mockPush).toHaveBeenCalledTimes(1);
  });

  it('calls the global logout action once', async () => {
    const logout = jest.fn(async () => undefined);
    const view = await renderWithProviders(<MoreScreen />, {
      authService: stubAuthService({ logout }),
    });

    await fireEvent.press(await view.findByTestId('more-logout'));
    await fireEvent.press(view.getByTestId('more-logout'));

    await waitFor(() => expect(logout).toHaveBeenCalledTimes(1));
  });

  it('still reaches unauthenticated state when the logout request fails', async () => {
    const logout = jest.fn(async () => {
      throw new ApiError('network_unavailable');
    });
    const view = await renderWithProviders(<MoreScreen />, {
      authService: stubAuthService({ logout }),
    });

    await fireEvent.press(await view.findByTestId('more-logout'));

    await waitFor(() => expect(logout).toHaveBeenCalledTimes(1));
    expect(view.queryByText(/network|unavailable|error/iu)).toBeNull();
  });
});
