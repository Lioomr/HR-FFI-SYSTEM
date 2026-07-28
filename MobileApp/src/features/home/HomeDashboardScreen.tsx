import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { RefreshControl, StyleSheet, View } from 'react-native';

import {
  AppText,
  AttendancePulse,
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
import { colors, radii, spacing } from '@/design-system';
import { useLocalization } from '@/i18n';
import { useAuth } from '@/providers/AuthProvider';
import { ApiError } from '@/services/api';

import {
  attendanceStatusPresentation,
  formatDateValue,
  formatTimeValue,
  localizedCount,
  ResourceFailure,
} from '../shared';

import type {
  AnnouncementPreview,
  AttendanceRecordPreview,
  HomeSection,
  LeaveBalancePreview,
} from './types';
import { useHomeDashboard } from './useHomeDashboard';

function AttendanceCard({
  retrying,
  section,
  retry,
}: {
  retrying: boolean;
  section: HomeSection<AttendanceRecordPreview[]>;
  retry: () => void;
}) {
  const localization = useLocalization();
  const { directionHelpers, t } = localization;

  if (section.status === 'error') {
    return <ResourceFailure compact kind={section.kind} onRetry={retry} retrying={retrying} />;
  }
  if (section.data.length === 0) {
    return (
      <EmptyState
        compact
        emoji="⏱️"
        message={t('attendance.noRecord')}
        title={t('dashboard.attendanceStatus')}
      />
    );
  }

  const latest = section.data[0];
  const statusLabel = latest.checkOutAt
    ? t('attendance.checkedOut')
    : latest.checkInAt
      ? t('attendance.checkedIn')
      : t('attendance.notCheckedIn');

  return (
    <Card accessibilityLabel={`${t('dashboard.attendanceStatus')}: ${statusLabel}`} elevated>
      <View style={[styles.cardHeader, directionHelpers.row]}>
        <View style={styles.cardHeadingCopy}>
          <SectionHeader title={t('dashboard.attendanceStatus')} />
          <AppText style={directionHelpers.text} variant="headline">
            {statusLabel}
          </AppText>
        </View>
        <AttendancePulse compact />
      </View>
      <View accessibilityRole="list" style={styles.timeline}>
        {section.data.slice(0, 3).map((record, index) => {
          const status = attendanceStatusPresentation(record.status);
          return (
            <View
              accessibilityRole="text"
              key={String(record.id ?? `${record.date ?? 'record'}-${index}`)}
              style={[styles.timelineRow, directionHelpers.row]}
            >
              <View style={styles.timelineMarker} />
              <AppText style={[styles.timelineDate, directionHelpers.text]} variant="subhead">
                {formatDateValue(localization, record.date)}
              </AppText>
              <AppText style={directionHelpers.text} tone="muted" variant="footnote">
                {`${formatTimeValue(localization, record.checkInAt)} – ${formatTimeValue(localization, record.checkOutAt)}`}
              </AppText>
              {status ? (
                <StatusBadge glyph={status.glyph} label={t(status.labelKey)} tone={status.tone} />
              ) : null}
            </View>
          );
        })}
      </View>
    </Card>
  );
}

/** Keep the backend's type order while collapsing the remaining rows into a count. */
export function summarizeLeaveBalances(balances: LeaveBalancePreview[]): {
  headline: LeaveBalancePreview | null;
  otherTypes: number;
} {
  return {
    headline: balances.find((balance) => balance.remainingDays !== null) ?? balances[0] ?? null,
    otherTypes: Math.max(0, balances.length - 1),
  };
}

function LeaveBalanceCard({
  onOpenLeave,
  retrying,
  section,
  retry,
}: {
  onOpenLeave: () => void;
  retrying: boolean;
  section: HomeSection<LeaveBalancePreview[]>;
  retry: () => void;
}) {
  const localization = useLocalization();
  const { directionHelpers, t } = localization;

  if (section.status === 'error') {
    return <ResourceFailure compact kind={section.kind} onRetry={retry} retrying={retrying} />;
  }
  if (section.data.length === 0) {
    return (
      <EmptyState
        compact
        emoji="🌴"
        message={t('leave.noBalances')}
        title={t('dashboard.leaveBalance')}
      />
    );
  }

  const { headline, otherTypes } = summarizeLeaveBalances(section.data);
  const leaveType = headline?.leaveType ?? t('common.notAvailable');
  const remaining =
    headline?.remainingDays === null || headline?.remainingDays === undefined
      ? t('common.notAvailable')
      : localizedCount(localization, 'leave.availableDays', headline.remainingDays);
  const more =
    otherTypes > 0 ? localizedCount(localization, 'dashboard.moreLeaveTypes', otherTypes) : null;

  return (
    <Card
      accessibilityHint={t('accessibility.opensScreenHint', { screen: t('tabs.leave') })}
      accessibilityLabel={[
        t('dashboard.viewLeave'),
        t('dashboard.leaveBalance'),
        leaveType,
        remaining,
        more,
      ]
        .filter(Boolean)
        .join('. ')}
      onPress={onOpenLeave}
      testID="home-leave-balance"
    >
      <View
        style={[styles.balanceSummary, directionHelpers.row]}
        testID="home-leave-balance-content"
      >
        <View style={styles.balanceSummaryCopy}>
          <AppText style={directionHelpers.text} tone="muted" variant="footnote">
            {t('dashboard.leaveBalance')}
          </AppText>
          <AppText style={directionHelpers.text} variant="title2">
            {remaining}
          </AppText>
          <AppText style={directionHelpers.text} tone="muted" variant="footnote">
            {[leaveType, more].filter(Boolean).join(' · ')}
          </AppText>
        </View>
        <View style={[styles.balanceAction, directionHelpers.row]}>
          <AppText style={directionHelpers.text} variant="callout">
            {t('dashboard.viewLeave')}
          </AppText>
          <AppText
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={directionHelpers.directionalIcon}
            tone="muted"
            variant="title2"
          >
            ›
          </AppText>
        </View>
      </View>
    </Card>
  );
}

function AnnouncementsCard({
  onOpenAll,
  retrying,
  section,
  retry,
}: {
  onOpenAll: () => void;
  retrying: boolean;
  section: HomeSection<AnnouncementPreview[]>;
  retry: () => void;
}) {
  const localization = useLocalization();
  const { t } = localization;

  if (section.status === 'error') {
    return <ResourceFailure compact kind={section.kind} onRetry={retry} retrying={retrying} />;
  }
  if (section.data.length === 0) {
    return (
      <EmptyState
        compact
        emoji="📣"
        message={t('announcements.noAnnouncements')}
        title={t('dashboard.announcements')}
      />
    );
  }

  return (
    <Card>
      <SectionHeader
        title={t('dashboard.announcements')}
        trailing={
          <Button
            accessibilityHint={t('accessibility.opensScreenHint', {
              screen: t('tabs.notifications'),
            })}
            label={t('common.seeAll')}
            onPress={onOpenAll}
            size="compact"
            variant="ghost"
          />
        }
      />
      <View accessibilityRole="list" style={styles.announcementList}>
        {section.data.map((announcement, index) => (
          <View
            key={String(announcement.id ?? `${announcement.createdAt ?? 'announcement'}-${index}`)}
            style={index > 0 ? styles.separated : undefined}
          >
            <ListRow
              meta={formatDateValue(localization, announcement.createdAt)}
              subtitle={announcement.contentPreview ?? undefined}
              title={announcement.title ?? t('common.notAvailable')}
            />
          </View>
        ))}
      </View>
    </Card>
  );
}

function allSectionsFailed(snapshot: NonNullable<ReturnType<typeof useHomeDashboard>['snapshot']>) {
  return [
    snapshot.attendance,
    snapshot.leaveBalances,
    snapshot.announcements,
    snapshot.unreadNotifications,
  ].every((section) => section.status === 'error');
}

export function HomeDashboardScreen() {
  const router = useRouter();
  const { handleApiError, user } = useAuth();
  const localization = useLocalization();
  const { directionHelpers, t } = localization;
  const { isLoading, isRefreshing, isRetrying, refresh, retry, snapshot } = useHomeDashboard();

  useEffect(() => {
    if (!snapshot) return;
    const hasExpiredSession = [
      snapshot.attendance,
      snapshot.leaveBalances,
      snapshot.announcements,
      snapshot.unreadNotifications,
    ].some((section) => section.status === 'error' && section.kind === 'session-expired');
    if (hasExpiredSession) handleApiError(new ApiError('session_expired', 401));
  }, [handleApiError, snapshot]);

  if (isLoading || !snapshot) {
    return (
      <Screen contentContainerStyle={styles.content} scroll>
        <SkeletonCard testID="home-skeleton" />
        <SkeletonList rows={3} />
      </Screen>
    );
  }

  if (allSectionsFailed(snapshot)) {
    const sections = [
      snapshot.attendance,
      snapshot.leaveBalances,
      snapshot.announcements,
      snapshot.unreadNotifications,
    ];
    const kind = sections.some(
      (section) => section.status === 'error' && section.kind === 'session-expired',
    )
      ? 'session-expired'
      : sections.every((section) => section.status === 'error' && section.kind === 'offline')
        ? 'offline'
        : 'unavailable';
    return (
      <Screen>
        <ResourceFailure kind={kind} onRetry={retry} retrying={isRetrying} />
      </Screen>
    );
  }

  const name = user?.full_name?.trim() || user?.email || t('dashboard.welcome');
  const unread =
    snapshot.unreadNotifications.status === 'ready'
      ? localizedCount(localization, 'notifications.unreadCount', snapshot.unreadNotifications.data)
      : t('common.notAvailable');

  return (
    <Screen
      contentContainerStyle={styles.content}
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
      <View style={[styles.hero, directionHelpers.row]}>
        <View style={styles.heroCopy}>
          <ScreenHeader subtitle={unread} title={t('dashboard.greeting', { name })} />
        </View>
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={styles.orbit}
        >
          <View style={styles.orbitCore} />
        </View>
      </View>

      <Button
        accessibilityHint={t('accessibility.opensScreenHint', { screen: t('tabs.leave') })}
        fullWidth
        label={t('dashboard.requestLeave')}
        onPress={() => router.push('/leave')}
      />

      <AttendanceCard retry={retry} retrying={isRetrying} section={snapshot.attendance} />
      <LeaveBalanceCard
        onOpenLeave={() => router.push('/leave')}
        retry={retry}
        retrying={isRetrying}
        section={snapshot.leaveBalances}
      />
      <AnnouncementsCard
        onOpenAll={() => router.push('/notifications')}
        retry={retry}
        retrying={isRetrying}
        section={snapshot.announcements}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: spacing.xl,
    paddingBottom: spacing.section,
  },
  hero: {
    alignItems: 'center',
    gap: spacing.lg,
    justifyContent: 'space-between',
    minHeight: 104,
    paddingTop: spacing.sm,
  },
  heroCopy: {
    flex: 1,
  },
  orbit: {
    width: 58,
    height: 58,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.primary,
    backgroundColor: colors.primarySoft,
  },
  orbitCore: {
    width: 18,
    height: 18,
    borderRadius: radii.pill,
    backgroundColor: colors.primary,
  },
  cardHeader: {
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  cardHeadingCopy: {
    flex: 1,
    gap: spacing.xs,
  },
  timeline: {
    gap: spacing.md,
    marginTop: spacing.xl,
  },
  timelineRow: {
    minHeight: 44,
    alignItems: 'center',
    gap: spacing.sm,
    flexWrap: 'wrap',
  },
  timelineMarker: {
    width: 8,
    height: 8,
    borderRadius: radii.pill,
    backgroundColor: colors.primary,
  },
  timelineDate: {
    flex: 1,
  },
  balanceSummary: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    flexWrap: 'wrap',
  },
  balanceSummaryCopy: {
    flex: 1,
    gap: spacing.xxs,
  },
  balanceAction: {
    minHeight: 44,
    alignItems: 'center',
    gap: spacing.xs,
    flexShrink: 1,
  },
  announcementList: {
    marginTop: spacing.lg,
  },
  separated: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
});
