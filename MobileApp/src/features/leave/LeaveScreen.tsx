import { useCallback, useEffect, useState } from 'react';
import { RefreshControl, StyleSheet, View } from 'react-native';

import {
  AppText,
  Button,
  Card,
  EmptyState,
  ListRow,
  Screen,
  ScreenHeader,
  SectionHeader,
  SkeletonCard,
  SkeletonList,
  StatusBadge,
} from '@/components/ui';
import { colors, spacing } from '@/design-system';
import { useLocalization } from '@/i18n';
import { useAuth } from '@/providers';
import { ApiError } from '@/services/api';

import {
  formatDateValue,
  formatNumberValue,
  leaveStatusPresentation,
  localizedCount,
  ResourceFailure,
  useResource,
  type Resource,
} from '../shared';

import { currentYear, loadLeaveOverview } from './leave-api';
import { LeaveRequestDetail } from './LeaveRequestDetail';
import { LeaveRequestForm } from './LeaveRequestForm';
import type { LeaveBalance, LeaveRequestSummary, LeaveType } from './types';

type LeaveOverview = Awaited<ReturnType<typeof loadLeaveOverview>>;

function BalanceCard({
  onRetry,
  section,
  year,
}: {
  onRetry: () => void;
  section: Resource<LeaveBalance[]>;
  year: number;
}) {
  const localization = useLocalization();
  const { directionHelpers, t } = localization;

  if (section.status === 'loading') return <SkeletonCard testID="leave-balance-skeleton" />;
  if (section.status === 'error') {
    return <ResourceFailure compact kind={section.kind} onRetry={onRetry} />;
  }
  if (section.data.length === 0) {
    return (
      <EmptyState compact emoji="🌴" message={t('leave.noBalances')} title={t('leave.balance')} />
    );
  }

  return (
    <Card elevated>
      <SectionHeader hint={t('leave.balanceYear', { year })} title={t('leave.balance')} />
      <View accessibilityRole="list" style={styles.balances}>
        {section.data.map((balance, index) => {
          const name = balance.leaveType ?? t('common.notAvailable');
          const remaining =
            balance.remainingDays === null
              ? t('common.notAvailable')
              : localizedCount(localization, 'leave.availableDays', balance.remainingDays);
          const used =
            balance.usedDays === null
              ? null
              : t('leave.usedDays', { days: formatNumberValue(localization, balance.usedDays) });
          const total =
            balance.totalDays === null
              ? null
              : t('leave.totalDays', { days: formatNumberValue(localization, balance.totalDays) });

          return (
            <View
              accessibilityLabel={[name, remaining, used, total].filter(Boolean).join('. ')}
              accessibilityRole="text"
              key={String(balance.leaveTypeId ?? `${name}-${index}`)}
              style={styles.balanceRow}
            >
              <View style={[styles.balanceHeader, directionHelpers.row]}>
                <AppText style={[styles.balanceName, directionHelpers.text]} variant="callout">
                  {name}
                </AppText>
                <AppText style={directionHelpers.text} variant="headline">
                  {remaining}
                </AppText>
              </View>
              {used || total ? (
                <AppText style={directionHelpers.text} tone="muted" variant="footnote">
                  {[total, used].filter(Boolean).join(' · ')}
                </AppText>
              ) : null}
            </View>
          );
        })}
      </View>
    </Card>
  );
}

function RequestList({
  onRetry,
  onSelect,
  section,
}: {
  onRetry: () => void;
  onSelect: (request: LeaveRequestSummary) => void;
  section: Resource<LeaveRequestSummary[]>;
}) {
  const localization = useLocalization();
  const { t } = localization;

  if (section.status === 'loading')
    return <SkeletonList rows={3} testID="leave-requests-skeleton" />;
  if (section.status === 'error') {
    return <ResourceFailure compact kind={section.kind} onRetry={onRetry} />;
  }
  if (section.data.length === 0) {
    return (
      <EmptyState
        compact
        emoji="📄"
        message={t('leave.noRequests')}
        title={t('leave.myRequests')}
      />
    );
  }

  return (
    <Card>
      <View accessibilityRole="list" style={styles.list}>
        {section.data.map((request, index) => {
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
                onPress={() => onSelect(request)}
                subtitle={range}
                testID={`leave-request-${request.id ?? index}`}
                title={request.leaveTypeName ?? t('common.notAvailable')}
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
  );
}

function sectionsOf(overview: LeaveOverview): Resource<unknown>[] {
  return [overview.balances, overview.requests, overview.leaveTypes];
}

export function LeaveScreen() {
  const { handleApiError } = useAuth();
  const { t } = useLocalization();
  const [formVisible, setFormVisible] = useState(false);
  const [selected, setSelected] = useState<LeaveRequestSummary | null>(null);
  const year = currentYear();
  const { isRefreshing, refresh, resource, retry } = useResource<LeaveOverview>(
    useCallback(() => loadLeaveOverview(year), [year]),
  );

  useEffect(() => {
    if (resource.status !== 'ready') return;
    const expired = sectionsOf(resource.data).some(
      (section) => section.status === 'error' && section.kind === 'session-expired',
    );
    if (expired) handleApiError(new ApiError('session_expired', 401));
  }, [handleApiError, resource]);

  const afterMutation = useCallback(async () => {
    setFormVisible(false);
    setSelected(null);
    await refresh();
  }, [refresh]);

  const leaveTypes: LeaveType[] =
    resource.status === 'ready' && resource.data.leaveTypes.status === 'ready'
      ? resource.data.leaveTypes.data
      : [];

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
      <ScreenHeader subtitle={t('leave.subtitle')} title={t('leave.title')} />

      {resource.status === 'error' ? (
        <ResourceFailure kind={resource.kind} onRetry={() => void retry()} />
      ) : null}

      {resource.status === 'loading' ? (
        <>
          <SkeletonCard testID="leave-skeleton" />
          <SkeletonList rows={3} />
        </>
      ) : null}

      {resource.status === 'ready' ? (
        <>
          <BalanceCard
            onRetry={() => void retry()}
            section={resource.data.balances}
            year={resource.data.year}
          />

          <Button
            accessibilityHint={t('leave.newRequest')}
            fullWidth
            label={t('leave.requestLeave')}
            onPress={() => setFormVisible(true)}
            testID="leave-open-form"
          />

          <View style={styles.section}>
            <SectionHeader title={t('leave.myRequests')} />
            <RequestList
              onRetry={() => void retry()}
              onSelect={setSelected}
              section={resource.data.requests}
            />
          </View>

          <LeaveRequestForm
            leaveTypes={leaveTypes}
            onClose={() => setFormVisible(false)}
            onSubmitted={() => void afterMutation()}
            visible={formVisible}
          />
          <LeaveRequestDetail
            onCancelled={() => void afterMutation()}
            onClose={() => setSelected(null)}
            request={selected}
          />
        </>
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
  balances: {
    gap: spacing.lg,
    marginTop: spacing.lg,
  },
  balanceRow: {
    gap: spacing.xxs,
    minHeight: 44,
    justifyContent: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    paddingBottom: spacing.sm,
  },
  balanceHeader: {
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.lg,
  },
  balanceName: {
    flex: 1,
  },
  list: {
    gap: spacing.xs,
  },
  separated: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
});
