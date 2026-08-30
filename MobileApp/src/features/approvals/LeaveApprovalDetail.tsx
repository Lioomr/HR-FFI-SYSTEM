import { useCallback, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { normalizeRole } from '@/auth/role';
import { AppText, Button, DetailRow, DetailSheet, StatusBadge } from '@/components/ui';
import { colors, radii, spacing } from '@/design-system';
import { useLocalization } from '@/i18n';
import { useAuth } from '@/providers';

import { formatDateTimeValue, formatDateValue, leaveStatusPresentation } from '../shared';

import { actOnLeaveApproval, canActOnLeaveApproval } from './approvals-api';
import { RejectReasonPrompt } from './RejectReasonPrompt';
import type { ApprovalAction, ApprovalLeaveRequest } from './types';

interface LeaveApprovalDetailProps {
  request: ApprovalLeaveRequest | null;
  onClose: () => void;
  onDecided: () => void;
}

export function LeaveApprovalDetail({ onClose, onDecided, request }: LeaveApprovalDetailProps) {
  const { handleApiError, user } = useAuth();
  const localization = useLocalization();
  const { directionHelpers, t } = localization;
  const [pending, setPending] = useState<ApprovalAction | null>(null);
  const [rejectVisible, setRejectVisible] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const approverRole = useMemo(() => normalizeRole(user?.role), [user?.role]);
  const status = leaveStatusPresentation(request?.status ?? null);
  const canApprove = canActOnLeaveApproval(approverRole, request?.status ?? null, 'approve');
  const canReject = canActOnLeaveApproval(approverRole, request?.status ?? null, 'reject');
  const actionable = request?.id !== null && (canApprove || canReject);

  const close = useCallback(() => {
    setError(null);
    setRejectVisible(false);
    onClose();
  }, [onClose]);

  const decide = useCallback(
    async (action: ApprovalAction, comment?: string) => {
      if (!request || request.id === null || pending) return;
      setPending(action);
      setError(null);
      try {
        const outcome = await actOnLeaveApproval(approverRole, request.id, { action, comment });
        setRejectVisible(false);
        if (outcome.status === 'success') {
          onDecided();
          return;
        }
        setError(outcome.details[0] ?? t(outcome.messageKey));
      } catch (apiError) {
        setRejectVisible(false);
        if (!handleApiError(apiError)) setError(t('state.actionFailed'));
      } finally {
        setPending(null);
      }
    },
    [approverRole, handleApiError, onDecided, pending, request, t],
  );

  return (
    <>
      <DetailSheet
        footer={
          actionable ? (
            <>
              {canApprove ? (
                <Button
                  accessibilityLabel={
                    pending === 'approve' ? t('approvals.approving') : t('approvals.approve')
                  }
                  disabled={pending !== null}
                  fullWidth
                  label={t('approvals.approve')}
                  loading={pending === 'approve'}
                  onPress={() => void decide('approve')}
                  testID="approvals-approve"
                />
              ) : null}
              {canReject ? (
                <Button
                  disabled={pending !== null}
                  fullWidth
                  label={t('approvals.reject')}
                  onPress={() => setRejectVisible(true)}
                  testID="approvals-reject"
                  variant="destructive"
                />
              ) : null}
            </>
          ) : null
        }
        onClose={close}
        subtitle={request?.employeeName ?? undefined}
        testID="approvals-leave-detail"
        title={t('approvals.requestDetail')}
        visible={request !== null && !rejectVisible}
      >
        {error ? (
          <View
            accessibilityLiveRegion="assertive"
            style={styles.errorBlock}
            testID="approvals-detail-error"
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
            label={t('approvals.requester')}
            value={request?.employeeName ?? request?.employeeEmail ?? t('common.notAvailable')}
          />
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
          <DetailRow
            label={t('leave.reason')}
            value={request?.reason ?? t('common.notAvailable')}
          />
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

        {!actionable && request ? (
          <AppText style={directionHelpers.text} tone="muted" variant="footnote">
            {t('approvals.notActionable')}
          </AppText>
        ) : null}
      </DetailSheet>

      {rejectVisible ? (
        <RejectReasonPrompt
          busy={pending === 'reject'}
          onCancel={() => setRejectVisible(false)}
          onConfirm={(comment) => void decide('reject', comment)}
          visible
        />
      ) : null}
    </>
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
