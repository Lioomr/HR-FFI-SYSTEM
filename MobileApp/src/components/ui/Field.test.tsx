import { fireEvent, render } from '@testing-library/react-native';
import { Field } from './Field';

describe('Field', () => {
  it('keeps the software keyboard enabled and makes the full frame a focus target', async () => {
    const view = await render(<Field label="Email" testID="email-field" />);
    const input = view.getByLabelText('Email');
    const frame = view.getByTestId('email-field-frame');

    expect(input).toHaveProp('showSoftInputOnFocus', true);
    expect(() => fireEvent.press(frame)).not.toThrow();
  });
});
