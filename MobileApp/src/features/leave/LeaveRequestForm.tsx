import { useCallback, useMemo, useState } from 'react';
import { Keyboard, Pressable, StyleSheet, View } from 'react-native';

import { createControlAccessibility } from '@/accessibility';
import { AppText, Button, DetailSheet, EmptyState, Field } from '@/components/ui';
import { colors, layout, radii, spacing } from '@/design-system';
import { useLocalization } from '@/i18n';
import { useAuth } from '@/providers';

import { submitLeaveRequest, validateLeaveDraft } from './leave-api';
import type { LeaveDraftValidation, LeaveRequestDraft, LeaveType } from './types';

interface LeaveRequestFormProps {
  visible: boolean;
  leaveTypes: LeaveType[];
  onClose: () => void;
  onSubmitted: () => void;
}

const EMPTY_DRAFT: LeaveRequestDraft = {
  leaveTypeId: null,
  startDate: '',
  endDate: '',
  reason: '',
};

function LeaveTypeOption({
  onPress,
  selected,
  type,
}: {
  onPress: () => void;
  selected: boolean;
  type: LeaveType;
}) {
  const { t } = useLocalization();
  const label = type.name ?? type.code ?? t('common.notAvailable');

  return (
    <Pressable
      {...createControlAccessibility({ label, role: 'radio', selected })}
      onPress={onPress}
      style={({ pressed }) => [
        styles.option,
        selected && styles.optionSelected,
        pressed && styles.optionPressed,
      ]}
      testID={`leave-type-${type.id}`}
    >
      <AppText
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        variant="callout"
      >
        {selected ? `✓  ${label}` : label}
      </AppText>
    </Pressable>
  );
}

export function LeaveRequestForm({
  leaveTypes,
  onClose,
  onSubmitted,
  visible,
}: LeaveRequestFormProps) {
  const { handleApiError } = useAuth();
  const { directionHelpers, t } = useLocalization();
  const [draft, setDraft] = useState<LeaveRequestDraft>(EMPTY_DRAFT);
  const [fieldErrors, setFieldErrors] = useState<LeaveDraftValidation>({});
  const [serverErrors, setServerErrors] = useState<readonly string[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const reset = useCallback(() => {
    setDraft(EMPTY_DRAFT);
    setFieldErrors({});
    setServerErrors([]);
    setFormError(null);
  }, []);

  const close = useCallback(() => {
    reset();
    onClose();
  }, [onClose, reset]);

  const submit = useCallback(async () => {
    if (submitting) return;
    Keyboard.dismiss();
    const errors = validateLeaveDraft(draft);
    setFieldErrors(errors);
    setServerErrors([]);
    setFormError(null);
    if (Object.keys(errors).length > 0) return;

    setSubmitting(true);
    try {
      const outcome = await submitLeaveRequest(draft);
      if (outcome.status === 'success') {
        reset();
        onSubmitted();
        return;
      }
      setFormError(t(outcome.messageKey));
      setServerErrors(outcome.details);
    } catch (error) {
      if (!handleApiError(error)) setFormError(t('state.actionFailed'));
    } finally {
      setSubmitting(false);
    }
  }, [draft, handleApiError, onSubmitted, reset, submitting, t]);

  const hasLeaveTypes = leaveTypes.length > 0;
  const footer = useMemo(
    () => (
      <>
        <Button
          accessibilityLabel={submitting ? t('common.submitting') : t('leave.submitRequest')}
          disabled={!hasLeaveTypes}
          fullWidth
          label={t('leave.submitRequest')}
          loading={submitting}
          onPress={() => void submit()}
          testID="leave-submit"
        />
        <Button
          disabled={submitting}
          fullWidth
          label={t('common.cancel')}
          onPress={close}
          variant="ghost"
        />
      </>
    ),
    [close, hasLeaveTypes, submit, submitting, t],
  );

  return (
    <DetailSheet
      footer={footer}
      onClose={close}
      subtitle={t('leave.dateFormatHint')}
      testID="leave-request-form"
      title={t('leave.newRequest')}
      visible={visible}
    >
      {formError ? (
        <View
          accessibilityLiveRegion="assertive"
          style={styles.errorBlock}
          testID="leave-form-error"
        >
          <AppText style={directionHelpers.text} tone="error" variant="headline">
            {formError}
          </AppText>
          {serverErrors.map((detail) => (
            <AppText key={detail} style={directionHelpers.text} tone="error" variant="subhead">
              {detail}
            </AppText>
          ))}
        </View>
      ) : null}

      <View style={styles.section}>
        <AppText accessibilityRole="header" style={directionHelpers.text} variant="headline">
          {t('leave.leaveType')}
        </AppText>
        {hasLeaveTypes ? (
          <View accessibilityRole="radiogroup" style={styles.options}>
            {leaveTypes.map((type) => (
              <LeaveTypeOption
                key={String(type.id)}
                onPress={() => setDraft((current) => ({ ...current, leaveTypeId: type.id }))}
                selected={String(draft.leaveTypeId) === String(type.id)}
                type={type}
              />
            ))}
          </View>
        ) : (
          <EmptyState
            compact
            emoji="🗂️"
            message={t('leave.noLeaveTypes')}
            title={t('leave.leaveType')}
          />
        )}
        {fieldErrors.leaveTypeId ? (
          <AppText accessibilityLiveRegion="polite" tone="error" variant="footnote">
            {t(fieldErrors.leaveTypeId)}
          </AppText>
        ) : null}
      </View>

      <Field
        autoCapitalize="none"
        autoCorrect={false}
        error={fieldErrors.startDate ? t(fieldErrors.startDate) : undefined}
        helperText={t('leave.dateFormatHint')}
        inputMode="numeric"
        label={t('leave.startDate')}
        onChangeText={(value) => setDraft((current) => ({ ...current, startDate: value.trim() }))}
        placeholder="2026-01-10"
        testID="leave-start-date"
        value={draft.startDate}
      />
      <Field
        autoCapitalize="none"
        autoCorrect={false}
        error={fieldErrors.endDate ? t(fieldErrors.endDate) : undefined}
        helperText={t('leave.dateFormatHint')}
        inputMode="numeric"
        label={t('leave.endDate')}
        onChangeText={(value) => setDraft((current) => ({ ...current, endDate: value.trim() }))}
        placeholder="2026-01-12"
        testID="leave-end-date"
        value={draft.endDate}
      />
      <Field
        label={t('leave.reason')}
        multiline
        numberOfLines={3}
        onChangeText={(value) => setDraft((current) => ({ ...current, reason: value }))}
        placeholder={t('leave.reasonPlaceholder')}
        testID="leave-reason"
        value={draft.reason}
      />
    </DetailSheet>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: spacing.md,
  },
  options: {
    gap: spacing.sm,
  },
  option: {
    minHeight: layout.minTouchTarget,
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  optionSelected: {
    borderColor: colors.text,
    borderWidth: 2,
    backgroundColor: colors.primarySoft,
  },
  optionPressed: {
    opacity: 0.76,
  },
  errorBlock: {
    gap: spacing.xs,
    borderWidth: 1,
    borderColor: colors.error,
    borderRadius: radii.md,
    backgroundColor: colors.errorSoft,
    padding: spacing.lg,
  },
});
