import { useCallback, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { normalizeRole } from '@/auth/role';
import { AppText, Button, DetailRow, DetailSheet, StatusBadge } from '@/components/ui';
import { colors, radii, spacing } from '@/design-system';
import { useLocalization } from '@/i18n';
import { useAuth } from '@/providers';

import {
  attendanceCorrectionStatusPresentation,
  attendanceStatusPresentation,
  formatDateTimeValue,
  formatDateValue,
} from '../shared';

import {
  actOnAttendanceCorrection,
  canActOnAttendanceCorrection,
} from './attendance-corrections-api';
import { RejectReasonPrompt } from './RejectReasonPrompt';
import type { ApprovalAction, AttendanceCorrectionApproval } from './types';

export function AttendanceCorrectionDetail({
  correction,
  onClose,
  onDecided,
}: {
  correction: AttendanceCorrectionApproval | null;
  onClose: () => void;
  onDecided: () => void;
}) {
  const { handleApiError, user } = useAuth();
  const localization = useLocalization();
  const { directionHelpers, t } = localization;
  const [pending, setPending] = useState<ApprovalAction | null>(null);
  const [rejectVisible, setRejectVisible] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const role = useMemo(() => normalizeRole(user?.role), [user?.role]);
  const canApprove = canActOnAttendanceCorrection(role, correction?.status ?? null, 'approve');
  const canReject = canActOnAttendanceCorrection(role, correction?.status ?? null, 'reject');
  const status = attendanceCorrectionStatusPresentation(correction?.status ?? null);

  const decide = useCallback(
    async (action: ApprovalAction, notes = '') => {
      if (!correction || correction.id === null || pending) return;
      setPending(action);
      setError(null);
      try {
        const outcome = await actOnAttendanceCorrection(role, correction.id, action, notes);
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
    [correction, handleApiError, onDecided, pending, role, t],
  );

  return (
    <>
      <DetailSheet
        footer={
          correction?.id !== null && (canApprove || canReject) ? (
            <>
              {canApprove ? (
                <Button
                  disabled={pending !== null}
                  fullWidth
                  label={t('approvals.approve')}
                  loading={pending === 'approve'}
                  onPress={() => void decide('approve')}
                  testID="attendance-correction-approve"
                />
              ) : null}
              {canReject ? (
                <Button
                  disabled={pending !== null}
                  fullWidth
                  label={t('approvals.reject')}
                  onPress={() => setRejectVisible(true)}
                  testID="attendance-correction-reject"
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
        subtitle={correction?.employeeName ?? correction?.employeeEmail ?? undefined}
        testID="attendance-correction-detail"
        title={t('attendanceCorrections.requestDetail')}
        visible={correction !== null && !rejectVisible}
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
            label={t('approvals.requester')}
            value={
              correction?.employeeName ?? correction?.employeeEmail ?? t('common.notAvailable')
            }
          />
          <DetailRow
            label={t('attendanceCorrections.date')}
            value={formatDateValue(localization, correction?.date ?? null)}
          />
          <DetailRow
            label={t('attendanceCorrections.current')}
            value={t('attendanceCorrections.timeRange', {
              start: formatDateTimeValue(localization, correction?.currentCheckInAt ?? null),
              end: formatDateTimeValue(localization, correction?.currentCheckOutAt ?? null),
            })}
          />
          <DetailRow
            label={t('attendanceCorrections.requested')}
            value={t('attendanceCorrections.timeRange', {
              start: formatDateTimeValue(localization, correction?.requestedCheckInAt ?? null),
              end: formatDateTimeValue(localization, correction?.requestedCheckOutAt ?? null),
            })}
          />
          {attendanceStatusPresentation(correction?.requestedStatus ?? null) ? (
            <DetailRow
              label={t('attendanceCorrections.requestedStatus')}
              value={t(attendanceStatusPresentation(correction?.requestedStatus ?? null)!.labelKey)}
            />
          ) : null}
          <DetailRow
            label={t('leave.reason')}
            value={correction?.reason ?? t('common.notAvailable')}
          />
          <DetailRow
            label={t('leave.submittedOn')}
            value={formatDateTimeValue(localization, correction?.createdAt ?? null)}
          />
        </View>
      </DetailSheet>
      {rejectVisible ? (
        <RejectReasonPrompt
          busy={pending === 'reject'}
          onCancel={() => setRejectVisible(false)}
          onConfirm={(notes) => void decide('reject', notes)}
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
    gap: spacing.xs,
    padding: spacing.lg,
  },
});
