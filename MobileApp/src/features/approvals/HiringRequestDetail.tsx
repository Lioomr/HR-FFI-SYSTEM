import { useCallback, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { normalizeRole } from '@/auth/role';
import { AppText, Button, DetailRow, DetailSheet, StatusBadge } from '@/components/ui';
import { colors, radii, spacing } from '@/design-system';
import { useLocalization } from '@/i18n';
import { useAuth } from '@/providers';

import { formatDateTimeValue, hiringRequestStatusPresentation } from '../shared';

import { actOnHiringApproval, canActOnHiringApproval } from './hiring-approvals-api';
import { RejectReasonPrompt } from './RejectReasonPrompt';
import type { ApprovalAction, HiringRequestApproval } from './types';

export function HiringRequestDetail({
  request,
  onClose,
  onDecided,
}: {
  request: HiringRequestApproval | null;
  onClose: () => void;
  onDecided: () => void;
}) {
  const { handleApiError, user } = useAuth();
  const localization = useLocalization();
  const { directionHelpers, t } = localization;
  const [pending, setPending] = useState<ApprovalAction | null>(null);
  const [rejectVisible, setRejectVisible] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const approverRole = useMemo(() => normalizeRole(user?.role), [user?.role]);
  const canApprove = canActOnHiringApproval(approverRole, request?.status ?? null, 'approve');
  const canReject = canActOnHiringApproval(approverRole, request?.status ?? null, 'reject');
  const status = hiringRequestStatusPresentation(request?.status ?? null);

  const decide = useCallback(
    async (action: ApprovalAction, note = '') => {
      if (!request || request.id === null || pending) return;
      setPending(action);
      setError(null);
      try {
        const outcome = await actOnHiringApproval(approverRole, request.id, action, note);
        if (outcome.status === 'success') {
          setRejectVisible(false);
          onDecided();
          return;
        }
        setError(outcome.details[0] ?? t(outcome.messageKey));
      } catch (apiError) {
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
          request?.id !== null && (canApprove || canReject) ? (
            <>
              {canApprove ? (
                <Button
                  disabled={pending !== null}
                  fullWidth
                  label={t('approvals.approve')}
                  loading={pending === 'approve'}
                  onPress={() => void decide('approve')}
                  testID="hiring-request-approve"
                />
              ) : null}
              {canReject ? (
                <Button
                  disabled={pending !== null}
                  fullWidth
                  label={t('approvals.reject')}
                  onPress={() => setRejectVisible(true)}
                  testID="hiring-request-reject"
                  variant="destructive"
                />
              ) : null}
            </>
          ) : null
        }
        onClose={() => {
          setError(null);
          setRejectVisible(false);
          onClose();
        }}
        subtitle={request?.referenceNumber ?? undefined}
        testID="hiring-request-detail"
        title={t('hiring.requestDetail')}
        visible={request !== null}
      >
        {error ? (
          <View accessibilityLiveRegion="assertive" style={styles.errorBlock}>
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
            label={t('hiring.candidate')}
            value={request?.candidateFullName ?? t('common.notAvailable')}
          />
          <DetailRow
            label={t('approvals.requester')}
            value={request?.requestedByName ?? t('common.notAvailable')}
          />
          <DetailRow
            label={t('hiring.reference')}
            value={request?.referenceNumber ?? t('common.notAvailable')}
          />
          <DetailRow
            label={t('hiring.submittedOn')}
            value={formatDateTimeValue(localization, request?.submittedAt ?? null)}
          />
          {request?.ceoDecisionNote ? (
            <DetailRow label={t('leave.decisionNote')} value={request.ceoDecisionNote} />
          ) : null}
        </View>
      </DetailSheet>
      {rejectVisible ? (
        <RejectReasonPrompt
          busy={pending === 'reject'}
          onCancel={() => setRejectVisible(false)}
          onConfirm={(note) => void decide('reject', note)}
          required={false}
          visible
        />
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  rows: { gap: spacing.md },
  errorBlock: {
    backgroundColor: colors.errorSoft,
    borderColor: colors.error,
    borderRadius: radii.md,
    borderWidth: 1,
    padding: spacing.lg,
  },
});
