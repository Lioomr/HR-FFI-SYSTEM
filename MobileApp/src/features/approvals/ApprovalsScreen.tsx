import { useCallback, useState } from 'react';
import { RefreshControl, StyleSheet, View } from 'react-native';

import { normalizeRole } from '@/auth/role';
import {
  Button,
  Card,
  EmptyState,
  ListRow,
  Screen,
  ScreenHeader,
  SectionHeader,
  SkeletonList,
  StatusBadge,
} from '@/components/ui';
import { colors, spacing } from '@/design-system';
import { useLocalization } from '@/i18n';
import { useAuth } from '@/providers';

import {
  attendanceCorrectionStatusPresentation,
  formatDateValue,
  hiringRequestStatusPresentation,
  leaveStatusPresentation,
  localizedCount,
  ResourceFailure,
  useResource,
} from '../shared';

import { hasLeaveApprovalAccess, loadLeaveApprovals } from './approvals-api';
import {
  hasAttendanceCorrectionApprovalAccess,
  loadAttendanceCorrectionApprovals,
} from './attendance-corrections-api';
import { AttendanceCorrectionDetail } from './AttendanceCorrectionDetail';
import { DelegationRulesSheet } from './DelegationRulesSheet';
import { LeaveApprovalDetail } from './LeaveApprovalDetail';
import { HiringRequestDetail } from './HiringRequestDetail';
import { hasHiringApprovalAccess, loadHiringApprovals } from './hiring-approvals-api';
import type {
  ApprovalLeaveRequest,
  AttendanceCorrectionApproval,
  HiringRequestApproval,
} from './types';

/**
 * The approver home. Later domains (attendance corrections, hiring, loans) and
 * delegation become inner sections of this one screen — never new routes, so the
 * record-identifier-free URL surface stays intact.
 */
export function ApprovalsScreen() {
  const { user } = useAuth();
  const localization = useLocalization();
  const { t } = localization;
  const [selected, setSelected] = useState<ApprovalLeaveRequest | null>(null);
  const [selectedCorrection, setSelectedCorrection] = useState<AttendanceCorrectionApproval | null>(
    null,
  );
  const [selectedHiringRequest, setSelectedHiringRequest] = useState<HiringRequestApproval | null>(
    null,
  );
  const [delegationsOpen, setDelegationsOpen] = useState(false);

  const approverRole = normalizeRole(user?.role);
  const canApproveLeave = hasLeaveApprovalAccess(approverRole);
  const canApproveCorrections = hasAttendanceCorrectionApprovalAccess(approverRole);
  const canApproveHiring = hasHiringApprovalAccess(approverRole);
  const hasApprovalSurface = canApproveLeave || canApproveCorrections || canApproveHiring;

  const { isRefreshing, refresh, resource, retry } = useResource<ApprovalLeaveRequest[]>(
    useCallback(() => loadLeaveApprovals(approverRole), [approverRole]),
  );
  const {
    isRefreshing: isRefreshingCorrections,
    refresh: refreshCorrections,
    resource: corrections,
    retry: retryCorrections,
  } = useResource<AttendanceCorrectionApproval[]>(
    useCallback(() => loadAttendanceCorrectionApprovals(approverRole), [approverRole]),
  );
  const {
    isRefreshing: isRefreshingHiring,
    refresh: refreshHiring,
    resource: hiringRequests,
    retry: retryHiring,
  } = useResource<HiringRequestApproval[]>(
    useCallback(() => loadHiringApprovals(approverRole), [approverRole]),
  );

  const afterDecision = useCallback(async () => {
    setSelected(null);
    await refresh();
  }, [refresh]);

  const afterCorrectionDecision = useCallback(async () => {
    setSelectedCorrection(null);
    await refreshCorrections();
  }, [refreshCorrections]);

  const afterHiringDecision = useCallback(async () => {
    setSelectedHiringRequest(null);
    await refreshHiring();
  }, [refreshHiring]);

  return (
    <Screen
      contentContainerStyle={styles.content}
      edges={['top', 'right', 'left']}
      scroll
      scrollViewProps={{
        refreshControl: (
          <RefreshControl
            accessibilityLabel={t('common.refresh')}
            colors={[colors.text]}
            onRefresh={() => void Promise.all([refresh(), refreshCorrections(), refreshHiring()])}
            refreshing={isRefreshing || isRefreshingCorrections || isRefreshingHiring}
            tintColor={colors.text}
          />
        ),
      }}
    >
      <ScreenHeader subtitle={t('approvals.subtitle')} title={t('approvals.title')} />

      {hasApprovalSurface ? (
        <Button
          label={t('delegations.manage')}
          onPress={() => setDelegationsOpen(true)}
          testID="delegations-open"
          variant="secondary"
        />
      ) : null}

      {!hasApprovalSurface ? (
        <EmptyState emoji="🗂️" message={t('state.unauthorizedBody')} title={t('approvals.title')} />
      ) : null}

      {canApproveLeave && resource.status === 'error' ? (
        <ResourceFailure kind={resource.kind} onRetry={() => void retry()} />
      ) : null}

      {canApproveLeave && resource.status === 'loading' ? (
        <SkeletonList rows={3} testID="approvals-skeleton" />
      ) : null}

      {canApproveLeave && resource.status === 'ready' ? (
        <View style={styles.section}>
          <SectionHeader
            hint={localizedCount(localization, 'approvals.pendingCount', resource.data.length)}
            title={t('approvals.leaveSection')}
          />
          {resource.data.length === 0 ? (
            <EmptyState
              compact
              emoji="✅"
              message={t('approvals.noRequests')}
              title={t('approvals.leaveSection')}
            />
          ) : (
            <Card>
              <View accessibilityRole="list" style={styles.list}>
                {resource.data.map((request, index) => {
                  const status = leaveStatusPresentation(request.status);
                  const range = t('leave.dateRange', {
                    start: formatDateValue(localization, request.startDate),
                    end: formatDateValue(localization, request.endDate),
                  });
                  return (
                    <View
                      key={String(request.id ?? `${request.startDate ?? 'request'}-${index}`)}
                      style={index > 0 ? styles.separated : undefined}
                    >
                      <ListRow
                        accessibilityHint={t('accessibility.opensDetailHint')}
                        meta={
                          request.days === null
                            ? undefined
                            : localizedCount(localization, 'leave.days', request.days)
                        }
                        onPress={() => setSelected(request)}
                        subtitle={`${request.leaveTypeName ?? t('common.notAvailable')} · ${range}`}
                        testID={`approvals-request-${request.id ?? index}`}
                        title={
                          request.employeeName ?? request.employeeEmail ?? t('common.notAvailable')
                        }
                        trailing={
                          status ? (
                            <StatusBadge
                              glyph={status.glyph}
                              label={t(status.labelKey)}
                              tone={status.tone}
                            />
                          ) : null
                        }
                      />
                    </View>
                  );
                })}
              </View>
            </Card>
          )}

          <LeaveApprovalDetail
            onClose={() => setSelected(null)}
            onDecided={() => void afterDecision()}
            request={selected}
          />
          {delegationsOpen ? (
            <DelegationRulesSheet onClose={() => setDelegationsOpen(false)} />
          ) : null}
        </View>
      ) : null}

      {canApproveCorrections && corrections.status === 'error' ? (
        <ResourceFailure kind={corrections.kind} onRetry={() => void retryCorrections()} />
      ) : null}

      {canApproveCorrections && corrections.status === 'loading' ? (
        <SkeletonList rows={3} testID="attendance-corrections-skeleton" />
      ) : null}

      {canApproveCorrections && corrections.status === 'ready' ? (
        <View style={styles.section}>
          <SectionHeader
            hint={localizedCount(
              localization,
              'attendanceCorrections.pendingCount',
              corrections.data.length,
            )}
            title={t('attendanceCorrections.sectionTitle')}
          />
          {corrections.data.length === 0 ? (
            <EmptyState
              compact
              emoji="✅"
              message={t('attendanceCorrections.empty')}
              title={t('attendanceCorrections.sectionTitle')}
            />
          ) : (
            <Card>
              <View accessibilityRole="list" style={styles.list}>
                {corrections.data.map((correction, index) => {
                  const status = attendanceCorrectionStatusPresentation(correction.status);
                  return (
                    <View
                      key={String(correction.id ?? `${correction.date ?? 'correction'}-${index}`)}
                      style={index > 0 ? styles.separated : undefined}
                    >
                      <ListRow
                        accessibilityHint={t('accessibility.opensDetailHint')}
                        onPress={() => setSelectedCorrection(correction)}
                        subtitle={formatDateValue(localization, correction.date)}
                        testID={`attendance-correction-${correction.id ?? index}`}
                        title={
                          correction.employeeName ??
                          correction.employeeEmail ??
                          t('common.notAvailable')
                        }
                        trailing={
                          status ? (
                            <StatusBadge
                              glyph={status.glyph}
                              label={t(status.labelKey)}
                              tone={status.tone}
                            />
                          ) : null
                        }
                      />
                    </View>
                  );
                })}
              </View>
            </Card>
          )}
          <AttendanceCorrectionDetail
            correction={selectedCorrection}
            onClose={() => setSelectedCorrection(null)}
            onDecided={() => void afterCorrectionDecision()}
          />
        </View>
      ) : null}

      {canApproveHiring && hiringRequests.status === 'error' ? (
        <ResourceFailure kind={hiringRequests.kind} onRetry={() => void retryHiring()} />
      ) : null}

      {canApproveHiring && hiringRequests.status === 'loading' ? (
        <SkeletonList rows={3} testID="hiring-requests-skeleton" />
      ) : null}

      {canApproveHiring && hiringRequests.status === 'ready' ? (
        <View style={styles.section}>
          <SectionHeader
            hint={localizedCount(localization, 'hiring.pendingCount', hiringRequests.data.length)}
            title={t('hiring.sectionTitle')}
          />
          {hiringRequests.data.length === 0 ? (
            <EmptyState
              compact
              emoji="✅"
              message={t('hiring.empty')}
              title={t('hiring.sectionTitle')}
            />
          ) : (
            <Card>
              <View accessibilityRole="list" style={styles.list}>
                {hiringRequests.data.map((request, index) => {
                  const status = hiringRequestStatusPresentation(request.status);
                  return (
                    <View
                      key={String(request.id ?? `${request.referenceNumber ?? 'hiring'}-${index}`)}
                      style={index > 0 ? styles.separated : undefined}
                    >
                      <ListRow
                        accessibilityHint={t('accessibility.opensDetailHint')}
                        onPress={() => setSelectedHiringRequest(request)}
                        subtitle={request.referenceNumber ?? t('common.notAvailable')}
                        testID={`hiring-request-${request.id ?? index}`}
                        title={request.candidateFullName ?? t('common.notAvailable')}
                        trailing={
                          status ? (
                            <StatusBadge
                              glyph={status.glyph}
                              label={t(status.labelKey)}
                              tone={status.tone}
                            />
                          ) : null
                        }
                      />
                    </View>
                  );
                })}
              </View>
            </Card>
          )}
          <HiringRequestDetail
            onClose={() => setSelectedHiringRequest(null)}
            onDecided={() => void afterHiringDecision()}
            request={selectedHiringRequest}
          />
        </View>
      ) : null}

      {delegationsOpen && !canApproveLeave ? (
        <DelegationRulesSheet onClose={() => setDelegationsOpen(false)} />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: spacing.xl,
    paddingBottom: spacing.section,
  },
  section: {
    gap: spacing.md,
  },
  list: {
    gap: spacing.xs,
  },
  separated: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
});
