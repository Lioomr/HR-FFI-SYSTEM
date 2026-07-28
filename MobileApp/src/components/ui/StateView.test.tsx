import { render } from '@testing-library/react-native';

import { EmptyState, ErrorState, LoadingState } from './StateView';

describe('StateView emoji accents', () => {
  it('shows a decorative default emoji for an empty state', async () => {
    const view = await render(<EmptyState title="No data" />);

    expect(view.getByText('📭', { includeHiddenElements: true })).toHaveProp(
      'accessibilityElementsHidden',
      true,
    );
  });

  it('supports a context-specific emoji', async () => {
    const view = await render(<EmptyState emoji="🌴" title="No leave" />);

    expect(view.getByText('🌴', { includeHiddenElements: true })).toBeTruthy();
    expect(view.queryByText('📭', { includeHiddenElements: true })).toBeNull();
  });

  it('keeps loading states on the progress indicator', async () => {
    const view = await render(<LoadingState title="Loading" />);

    expect(view.getByText('Loading')).toBeTruthy();
    expect(view.queryByText('📭', { includeHiddenElements: true })).toBeNull();
  });

  it('uses a distinct error-state emoji', async () => {
    const view = await render(<ErrorState title="Try again" />);

    expect(view.getByText('🛠️', { includeHiddenElements: true })).toBeTruthy();
  });
});
