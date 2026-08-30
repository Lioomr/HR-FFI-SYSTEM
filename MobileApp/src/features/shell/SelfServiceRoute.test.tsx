import { describe, expect, it, jest } from '@jest/globals';
import { Text } from 'react-native';

import { renderWithProviders } from '@/qa/harness';

import { appRoutes } from './routes';
import { withSelfServiceGuard } from './SelfServiceRoute';

const mockUseAuth = jest.fn<() => { user: { role: string } | null }>();

jest.mock('@/providers', () => ({
  ...jest.requireActual<Record<string, unknown>>('@/providers'),
  useAuth: () => mockUseAuth(),
}));

jest.mock('expo-router', () => ({
  ...jest.requireActual<Record<string, unknown>>('expo-router'),
  Redirect: ({ href }: { href: string }) => {
    const { Text: RNText } = jest.requireActual<typeof import('react-native')>('react-native');
    return <RNText>{`redirect:${href}`}</RNText>;
  },
}));

function Guarded() {
  return <Text>self service body</Text>;
}

const Screen = withSelfServiceGuard(Guarded);

describe('withSelfServiceGuard', () => {
  it('renders the screen for self-service roles', async () => {
    for (const role of ['Employee', 'HRManager', 'Manager']) {
      mockUseAuth.mockReturnValue({ user: { role } });
      const view = await renderWithProviders(<Screen />);
      expect(view.getByText('self service body')).toBeTruthy();
    }
  });

  it('redirects approver-only roles to Approvals', async () => {
    for (const role of ['CEO', 'CFO', 'SystemAdmin']) {
      mockUseAuth.mockReturnValue({ user: { role } });
      const view = await renderWithProviders(<Screen />);
      expect(view.getByText(`redirect:${appRoutes.approvals}`)).toBeTruthy();
    }
  });
});
