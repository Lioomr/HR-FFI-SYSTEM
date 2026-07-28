import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText, Button, DetailRow, DetailSheet, StatusBadge } from '@/components/ui';
import { colors, radii, spacing } from '@/design-system';
import { useLocalization } from '@/i18n';
import { useAuth } from '@/providers';

import { formatDateTimeValue, formatDateValue, leaveStatusPresentation } from '../shared';

import { cancelLeaveRequest } from './leave-api';
import type { LeaveRequestSummary } from './types';

/** The statuses the verified backend cancel action accepts from the owner. */
const CANCELLABLE_STATUSES = new Set(['submitted', 'pending_hr', 'pending_manager']);

export function canCancel(request: LeaveRequestSummary | null): boolean {
  return Boolean(
    request?.id !== null && request?.status && CANCELLABLE_STATUSES.has(request.status),
  );
}

interface LeaveRequestDetailProps {
  request: LeaveRequestSummary | null;
  onClose: () => void;
  onCancelled: () => void;
}

export function LeaveRequestDetail({ onCancelled, onClose, request }: LeaveRequestDetailProps) {
  const { handleApiError } = useAuth();
  const localization = useLocalization();
  const { directionHelpers, t } = localization;
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = useCallback(() => {
    setError(null);
    onClose();
  }, [onClose]);

  const cancel = useCallback(async () => {
    if (!request || request.id === null || cancelling) return;
    setCancelling(true);
    setError(null);
    try {
      const outcome = await cancelLeaveRequest(request.id);
      if (outcome.status === 'success') {
        onCancelled();
        return;
      }
      setError(outcome.details[0] ?? t(outcome.messageKey));
    } catch (apiError) {
      if (!handleApiError(apiError)) setError(t('state.actionFailed'));
    } finally {
      setCancelling(false);
    }
  }, [cancelling, handleApiError, onCancelled, request, t]);

  const status = leaveStatusPresentation(request?.status ?? null);
  const cancellable = canCancel(request);

  return (
    <DetailSheet
      footer={
        cancellable ? (
          <Button
            accessibilityLabel={cancelling ? t('leave.cancelling') : t('leave.cancelRequest')}
            fullWidth
            label={t('leave.cancelRequest')}
            loading={cancelling}
            onPress={() => void cancel()}
            testID="leave-cancel"
            variant="destructive"
          />
        ) : null
      }
      onClose={close}
      subtitle={request?.leaveTypeName ?? undefined}
      testID="leave-request-detail"
      title={t('leave.requestDetail')}
      visible={request !== null}
    >
      {error ? (
        <View
          accessibilityLiveRegion="assertive"
          style={styles.errorBlock}
          testID="leave-detail-error"
        >
          <AppText style={directionHelpers.text} tone="error" variant="subhead">
            {error}
          </AppText>
        </View>
      ) : null}

      {status ? (
        <StatusBadge glyph={status.glyph} label={t(status.labelKey)} tone={status.tone} />
      ) : null}

      <View style={styles.rows}>
        <DetailRow
          label={t('leave.leaveType')}
          value={request?.leaveTypeName ?? t('common.notAvailable')}
        />
        <DetailRow
          label={t('leave.startDate')}
          value={formatDateValue(localization, request?.startDate ?? null)}
        />
        <DetailRow
          label={t('leave.endDate')}
          value={formatDateValue(localization, request?.endDate ?? null)}
        />
        <DetailRow
          label={t('leave.submittedOn')}
          value={formatDateTimeValue(localization, request?.createdAt ?? null)}
        />
        <DetailRow label={t('leave.reason')} value={request?.reason ?? t('common.notAvailable')} />
        {request?.decidedAt ? (
          <DetailRow
            label={t('leave.decision')}
            value={formatDateTimeValue(localization, request.decidedAt)}
          />
        ) : null}
        {request?.decisionReason ? (
          <DetailRow label={t('leave.decisionNote')} value={request.decisionReason} />
        ) : null}
      </View>

      {!cancellable && request ? (
        <AppText style={directionHelpers.text} tone="muted" variant="footnote">
          {t('leave.cancelOnlyPending')}
        </AppText>
      ) : null}
    </DetailSheet>
  );
}

const styles = StyleSheet.create({
  rows: {
    gap: spacing.md,
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
