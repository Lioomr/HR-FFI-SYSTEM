import { useCallback, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText, Button, DetailSheet, Field } from '@/components/ui';
import { layout, spacing } from '@/design-system';
import { useLocalization } from '@/i18n';

interface RejectReasonPromptProps {
  visible: boolean;
  busy?: boolean;
  /** Leave and attendance rejection require a reason; hiring decisions do not. */
  required?: boolean;
  onCancel: () => void;
  onConfirm: (comment: string) => void;
}

/**
 * The backend rejects a decision with an empty `comment` (422), so the reason is
 * collected before the network call rather than surfaced as a server error.
 * Kept local to this feature until a second domain needs the same prompt.
 *
 * The caller mounts this only while the prompt is open, so the draft reason
 * resets naturally on each open without an effect that mirrors `visible`.
 */
export function RejectReasonPrompt({
  busy = false,
  onCancel,
  onConfirm,
  required = true,
  visible,
}: RejectReasonPromptProps) {
  const { directionHelpers, t } = useLocalization();
  const [comment, setComment] = useState('');

  const trimmed = comment.trim();
  const confirm = useCallback(() => {
    if ((required && !trimmed) || busy) return;
    onConfirm(trimmed);
  }, [busy, onConfirm, required, trimmed]);

  const footer = useMemo(
    () => (
      <>
        <Button
          accessibilityLabel={busy ? t('approvals.rejecting') : t('approvals.rejectConfirm')}
          disabled={busy || (required && trimmed.length === 0)}
          fullWidth
          label={t('approvals.rejectConfirm')}
          loading={busy}
          onPress={confirm}
          testID="approvals-reject-confirm"
          variant="destructive"
        />
        <Button
          disabled={busy}
          fullWidth
          label={t('approvals.rejectCancel')}
          onPress={onCancel}
          testID="approvals-reject-cancel"
          variant="ghost"
        />
      </>
    ),
    [busy, confirm, onCancel, required, t, trimmed.length],
  );

  return (
    <DetailSheet
      footer={footer}
      onClose={onCancel}
      testID="approvals-reject-prompt"
      title={t('approvals.rejectReasonTitle')}
      visible={visible}
    >
      <View style={styles.body}>
        {required ? (
          <AppText style={directionHelpers.text} tone="muted" variant="subhead">
            {t('approvals.rejectReasonRequired')}
          </AppText>
        ) : null}
        <Field
          label={t('approvals.rejectReasonLabel')}
          multiline
          numberOfLines={4}
          onChangeText={setComment}
          placeholder={t('approvals.rejectReasonPlaceholder')}
          style={styles.input}
          testID="approvals-reject-reason"
          value={comment}
        />
      </View>
    </DetailSheet>
  );
}

const styles = StyleSheet.create({
  body: {
    gap: spacing.md,
  },
  input: {
    minHeight: layout.minTouchTarget,
  },
});
