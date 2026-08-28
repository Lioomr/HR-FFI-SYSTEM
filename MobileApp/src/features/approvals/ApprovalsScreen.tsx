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
  formatDateValue,
  leaveStatusPresentation,
  localizedCount,
  ResourceFailure,
  useResource,
} from '../shared';

import { hasLeaveApprovalAccess, loadLeaveApprovals } from './approvals-api';
import { DelegationRulesSheet } from './DelegationRulesSheet';
import { LeaveApprovalDetail } from './LeaveApprovalDetail';
import type { ApprovalLeaveRequest } from './types';

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
  const [delegationsOpen, setDelegationsOpen] = useState(false);

  const approverRole = normalizeRole(user?.role);
  const canApprove = hasLeaveApprovalAccess(approverRole);

  const { isRefreshing, refresh, resource, retry } = useResource<ApprovalLeaveRequest[]>(
    useCallback(() => loadLeaveApprovals(approverRole), [approverRole]),
  );

  const afterDecision = useCallback(async () => {
    setSelected(null);
    await refresh();
  }, [refresh]);

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
            onRefresh={() => void refresh()}
            refreshing={isRefreshing}
            tintColor={colors.text}
          />
        ),
      }}
    >
      <ScreenHeader subtitle={t('approvals.subtitle')} title={t('approvals.title')} />

      {canApprove ? (
        <Button
          label={t('delegations.manage')}
          onPress={() => setDelegationsOpen(true)}
          testID="delegations-open"
          variant="secondary"
        />
      ) : null}

      {!canApprove ? (
        <EmptyState emoji="🗂️" message={t('state.unauthorizedBody')} title={t('approvals.title')} />
      ) : null}

      {canApprove && resource.status === 'error' ? (
        <ResourceFailure kind={resource.kind} onRetry={() => void retry()} />
      ) : null}

      {canApprove && resource.status === 'loading' ? (
        <SkeletonList rows={3} testID="approvals-skeleton" />
      ) : null}

      {canApprove && resource.status === 'ready' ? (
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
