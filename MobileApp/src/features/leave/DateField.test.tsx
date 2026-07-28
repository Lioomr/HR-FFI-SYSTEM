import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent } from '@testing-library/react-native';

import { renderWithProviders } from '@/qa/harness';

import { DateField } from './DateField';

const mockPickedDate = { value: new Date(2026, 8, 15, 9, 30) };

jest.mock('@expo/ui/community/datetime-picker', () => {
  const { Pressable, Text } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    __esModule: true,
    default: ({
      display,
      locale,
      minimumDate,
      onValueChange,
      testID,
      value,
    }: {
      display?: string;
      locale?: string;
      minimumDate?: Date;
      onValueChange: (event: unknown, date: Date) => void;
      testID?: string;
      value: Date;
    }) => (
      <Pressable onPress={() => onValueChange({}, mockPickedDate.value)} testID={testID}>
        <Text testID={`${testID}-display`}>{display ?? 'none'}</Text>
        <Text testID={`${testID}-locale`}>{locale ?? 'none'}</Text>
        <Text testID={`${testID}-value`}>{value.toISOString()}</Text>
        <Text testID={`${testID}-minimum`}>{minimumDate?.toISOString() ?? 'none'}</Text>
      </Pressable>
    ),
  };
});

describe('DateField', () => {
  it('prompts for a choice instead of asking the employee to type a date', async () => {
    const view = await renderWithProviders(
      <DateField label="Start date" onChange={jest.fn()} testID="start" value="" />,
    );

    const trigger = view.getByTestId('start');
    expect(trigger.props.accessibilityRole).toBe('button');
    expect(trigger.props.accessibilityLabel).toBe('Start date: Choose a date');
    expect(trigger.props.accessibilityHint).toBe('Opens a calendar to choose a date');
    expect(view.queryByTestId('start-picker')).toBeNull();
  });

  it('opens the native calendar on press and reports the expanded state', async () => {
    const view = await renderWithProviders(
      <DateField label="Start date" onChange={jest.fn()} testID="start" value="" />,
    );

    await fireEvent.press(view.getByTestId('start'));

    expect(view.getByTestId('start-picker')).toBeTruthy();
    expect(view.getByTestId('start').props.accessibilityState.expanded).toBe(true);
    expect(view.getByTestId('start-native-display').props.children).toBe('inline');
    expect(view.getByTestId('start-native-minimum').props.children).toBe('none');
  });

  it('serializes the picked day as the API calendar date, not a UTC timestamp', async () => {
    const onChange = jest.fn<(iso: string) => void>();
    const view = await renderWithProviders(
      <DateField label="Start date" onChange={onChange} testID="start" value="" />,
    );

    await fireEvent.press(view.getByTestId('start'));
    await fireEvent.press(view.getByTestId('start-native'));

    expect(onChange).toHaveBeenCalledWith('2026-09-15');
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('ignores an invalid date from the native layer instead of submitting NaN', async () => {
    const onChange = jest.fn<(iso: string) => void>();
    mockPickedDate.value = new Date(Number.NaN);
    const view = await renderWithProviders(
      <DateField label="Start date" onChange={onChange} testID="start" value="" />,
    );

    await fireEvent.press(view.getByTestId('start'));
    await fireEvent.press(view.getByTestId('start-native'));

    expect(onChange).not.toHaveBeenCalled();
    mockPickedDate.value = new Date(2026, 8, 15, 9, 30);
  });

  it('shows the selected date formatted for the English locale', async () => {
    const view = await renderWithProviders(
      <DateField label="Start date" onChange={jest.fn()} testID="start" value="2026-08-01" />,
    );

    const label = view.getByTestId('start').props.accessibilityLabel as string;
    expect(label).toContain('Start date:');
    expect(label).toMatch(/August/u);
    expect(label).not.toContain('2026-08-01T');
  });

  it('formats the same date in Arabic and passes the locale to the native picker', async () => {
    const view = await renderWithProviders(
      <DateField label="تاريخ البداية" onChange={jest.fn()} testID="start" value="2026-08-01" />,
      { language: 'ar' },
    );

    const label = view.getByTestId('start').props.accessibilityLabel as string;
    expect(label).toContain('تاريخ البداية:');
    expect(label).not.toMatch(/August/u);

    await fireEvent.press(view.getByTestId('start'));
    expect(view.getByTestId('start-native-locale').props.children).toBe('ar-SA');
  });

  it('renders its own copy right-to-left in Arabic', async () => {
    const view = await renderWithProviders(
      <DateField label="تاريخ البداية" onChange={jest.fn()} testID="start" value="2026-08-01" />,
      { language: 'ar' },
    );

    expect(view.getByText('تاريخ البداية').props.style.flat()).toContainEqual(
      expect.objectContaining({ textAlign: 'right', writingDirection: 'rtl' }),
    );
  });

  it('surfaces a validation error politely without hiding the control', async () => {
    const view = await renderWithProviders(
      <DateField
        error="Enter a valid date."
        label="Start date"
        onChange={jest.fn()}
        testID="start"
        value=""
      />,
    );

    expect(view.getByText('Enter a valid date.')).toBeTruthy();
    expect(view.getByTestId('start')).toBeTruthy();
  });

  it('forwards a minimum selectable date to the native picker', async () => {
    const view = await renderWithProviders(
      <DateField
        label="End date"
        minimumDate={new Date(2026, 7, 1, 12)}
        onChange={jest.fn()}
        testID="end"
        value=""
      />,
    );

    await fireEvent.press(view.getByTestId('end'));

    expect(view.getByTestId('end-native-minimum').props.children).toContain('2026-08-01');
  });

  it('keeps the trigger at or above the 44 point touch target', async () => {
    const view = await renderWithProviders(
      <DateField label="Start date" onChange={jest.fn()} testID="start" value="" />,
    );

    const style = view.getByTestId('start').props.style as { minHeight?: number }[];
    const minHeight = style.flat().find((entry) => entry?.minHeight)?.minHeight;
    expect(minHeight).toBeGreaterThanOrEqual(44);
  });
});
