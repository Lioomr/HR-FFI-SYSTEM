import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render } from '@testing-library/react-native';

import { Button } from './Button';

describe('Button', () => {
  it('exposes its label and invokes its action', async () => {
    const onPress = jest.fn();
    const view = await render(<Button label="Clock in" onPress={onPress} />);

    fireEvent.press(view.getByRole('button', { name: 'Clock in' }));

    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('announces and blocks interaction while loading', async () => {
    const onPress = jest.fn();
    const view = await render(<Button label="Submit" loading onPress={onPress} />);
    const button = view.getByRole('button', { name: 'Submit' });

    expect(button.props.accessibilityState).toEqual({ busy: true, disabled: true });
    fireEvent.press(button);
    expect(onPress).not.toHaveBeenCalled();
  });
});
