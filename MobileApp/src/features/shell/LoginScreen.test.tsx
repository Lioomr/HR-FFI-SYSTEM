import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import type { PropsWithChildren } from 'react';

import type { AuthUser } from '@/auth';
import { LocalizationProvider } from '@/i18n';
import { AuthProvider, type AuthService } from '@/providers';
import { ApiError } from '@/services/api/api-error';

import { LoginScreen } from './LoginScreen';

const user: AuthUser = {
  accessible_organizations: [{ id: 7, name: 'FFI Egypt' }],
  default_organization_id: 7,
  email: 'employee@example.com',
  has_all_company_access: false,
  id: 'user-1',
  role: 'Employee',
};

function authService(login: AuthService['login']): AuthService {
  return {
    changePassword: jest.fn(async () => undefined),
    login,
    logout: jest.fn(async () => undefined),
    restoreSession: jest.fn(async () => null),
    selectActiveCompany: jest.fn(() => undefined),
  };
}

function wrapperFor(client: AuthService) {
  return function Wrapper({ children }: PropsWithChildren) {
    return (
      <LocalizationProvider locales={[{ languageCode: 'en', languageTag: 'en-US' }]}>
        <AuthProvider client={client}>{children}</AuthProvider>
      </LocalizationProvider>
    );
  };
}

describe('LoginScreen', () => {
  it('submits credentials through AuthProvider without placing them in navigation', async () => {
    const login = jest.fn<AuthService['login']>(async () => user);
    const view = await render(<LoginScreen />, { wrapper: wrapperFor(authService(login)) });

    await fireEvent.changeText(view.getByLabelText('Email'), ' employee@example.com ');
    await fireEvent.changeText(view.getByLabelText('Password'), 'private-password');
    await fireEvent.press(view.getByRole('button', { name: 'Sign in' }));

    await waitFor(() =>
      expect(login).toHaveBeenCalledWith({
        email: ' employee@example.com ',
        password: 'private-password',
      }),
    );
  });

  it('renders a localized safe error and never exposes server details', async () => {
    const login = jest.fn<AuthService['login']>(async () => {
      throw new ApiError('authentication_failed', 401);
    });
    const view = await render(<LoginScreen />, { wrapper: wrapperFor(authService(login)) });

    await fireEvent.changeText(view.getByLabelText('Email'), 'employee@example.com');
    await fireEvent.changeText(view.getByLabelText('Password'), 'private-password');
    await fireEvent.press(view.getByRole('button', { name: 'Sign in' }));

    expect(await view.findByText('The email or password is incorrect.')).toBeTruthy();
    expect(view.queryByText(/server|token|private transport/i)).toBeNull();
  });
});
