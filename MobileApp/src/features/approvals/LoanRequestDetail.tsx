import { useCallback, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { normalizeRole } from '@/auth/role';
import { AppText, Button, DetailRow, DetailSheet, StatusBadge } from '@/components/ui';
import { colors, radii, spacing } from '@/design-system';
import { useLocalization } from '@/i18n';
import { useAuth } from '@/providers';

import { formatDateTimeValue, loanRequestStatusPresentation } from '../shared';

import {
  actOnLoanApproval,
  canActOnLoanApproval,
  canReferLoanToCeo,
  type LoanApprovalAction,
} from './loan-approvals-api';
import { RejectReasonPrompt } from './RejectReasonPrompt';
import type { LoanRequestApproval } from './types';

export function LoanRequestDetail({
  request,
  onClose,
  onDecided,
}: {
  request: LoanRequestApproval | null;
  onClose: () => void;
  onDecided: () => void;
}) {
  const { handleApiError, user } = useAuth();
  const localization = useLocalization();
  const { directionHelpers, t } = localization;
  const [pending, setPending] = useState<LoanApprovalAction | null>(null);
  const [noteAction, setNoteAction] = useState<LoanApprovalAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const approverRole = useMemo(() => normalizeRole(user?.role), [user?.role]);
  const canApprove = canActOnLoanApproval(approverRole, request?.status ?? null, 'approve');
  const canReject = canActOnLoanApproval(approverRole, request?.status ?? null, 'reject');
  const canRefer = canReferLoanToCeo(approverRole, request?.status ?? null);
  const status = loanRequestStatusPresentation(request?.status ?? null);

  const decide = useCallback(
    async (action: LoanApprovalAction, comment = '') => {
      if (!request || request.id === null || pending) return;
      setPending(action);
      setError(null);
      try {
        const outcome = await actOnLoanApproval(approverRole, request.id, action, comment);
        setNoteAction(null);
        if (outcome.status === 'success') {
          onDecided();
          return;
        }
        setError(outcome.details[0] ?? t(outcome.messageKey));
      } catch (apiError) {
        setNoteAction(null);
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
          request?.id !== null && (canApprove || canReject || canRefer) ? (
            <>
              {canApprove ? (
                <Button
                  disabled={pending !== null}
                  fullWidth
                  label={t('approvals.approve')}
                  loading={pending === 'approve'}
                  onPress={() => void decide('approve')}
                  testID="loan-approve"
                />
              ) : null}
              {canRefer ? (
                <Button
                  disabled={pending !== null}
                  fullWidth
                  label={t('loans.referToCeo')}
                  onPress={() => setNoteAction('refer-to-ceo')}
                  testID="loan-refer-to-ceo"
                  variant="secondary"
                />
              ) : null}
              {canReject ? (
                <Button
                  disabled={pending !== null}
                  fullWidth
                  label={t('approvals.reject')}
                  onPress={() => setNoteAction('reject')}
                  testID="loan-reject"
                  variant="destructive"
                />
              ) : null}
            </>
          ) : null
        }
        onClose={() => {
          setError(null);
          setNoteAction(null);
          onClose();
        }}
        subtitle={request?.employeeName ?? request?.employeeEmail ?? undefined}
        testID="loan-request-detail"
        title={t('loans.requestDetail')}
        visible={request !== null && noteAction === null}
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
        {request?.status === 'pending_ceo' ? (
          <AppText style={directionHelpers.text} tone="muted" variant="footnote">
            {t('loans.referredByCfo')}
          </AppText>
        ) : null}
        <View style={styles.rows}>
          <DetailRow
            label={t('approvals.requester')}
            value={request?.employeeName ?? request?.employeeEmail ?? t('common.notAvailable')}
          />
          <DetailRow
            label={t('loans.loanType')}
            value={request?.loanType ?? t('common.notAvailable')}
          />
          <DetailRow
            label={t('loans.amount')}
            value={request?.requestedAmount?.toString() ?? t('common.notAvailable')}
          />
          <DetailRow
            label={t('leave.reason')}
            value={request?.reason ?? t('common.notAvailable')}
          />
          <DetailRow
            label={t('leave.submittedOn')}
            value={formatDateTimeValue(localization, request?.createdAt ?? null)}
          />
          {request?.hrDecisionNote ? (
            <DetailRow label={t('loans.hrNote')} value={request.hrDecisionNote} />
          ) : null}
          {request?.cfoDecisionNote ? (
            <DetailRow label={t('loans.cfoNote')} value={request.cfoDecisionNote} />
          ) : null}
          {request?.ceoDecisionNote ? (
            <DetailRow label={t('loans.ceoNote')} value={request.ceoDecisionNote} />
          ) : null}
        </View>
      </DetailSheet>
      {noteAction ? (
        <RejectReasonPrompt
          busy={pending === noteAction}
          confirmLabel={noteAction === 'refer-to-ceo' ? t('loans.referToCeo') : undefined}
          confirmVariant={noteAction === 'refer-to-ceo' ? 'secondary' : 'destructive'}
          onCancel={() => setNoteAction(null)}
          onConfirm={(comment) => void decide(noteAction, comment)}
          title={noteAction === 'refer-to-ceo' ? t('loans.referToCeo') : undefined}
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
