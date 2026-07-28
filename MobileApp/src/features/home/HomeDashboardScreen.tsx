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
  section,
  retry,
}: {
  section: HomeSection<AttendanceRecordPreview[]>;
  retry: () => void;
}) {
  const localization = useLocalization();
  const { directionHelpers, t } = localization;

  if (section.status === 'error') {
    return <ResourceFailure compact kind={section.kind} onRetry={retry} />;
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

function LeaveBalanceCard({
  section,
  retry,
}: {
  section: HomeSection<LeaveBalancePreview[]>;
  retry: () => void;
}) {
  const localization = useLocalization();
  const { directionHelpers, t } = localization;

  if (section.status === 'error') {
    return <ResourceFailure compact kind={section.kind} onRetry={retry} />;
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

  return (
    <Card>
      <SectionHeader title={t('dashboard.leaveBalance')} />
      <View accessibilityRole="list" style={styles.balanceList}>
        {section.data.map((balance, index) => {
          const leaveType = balance.leaveType ?? t('common.notAvailable');
          const remaining =
            balance.remainingDays === null
              ? t('common.notAvailable')
              : localizedCount(localization, 'leave.availableDays', balance.remainingDays);
          return (
            <View
              accessibilityLabel={`${leaveType}: ${remaining}`}
              accessibilityRole="text"
              key={String(balance.leaveTypeId ?? `${leaveType}-${index}`)}
              style={[styles.balanceRow, directionHelpers.row]}
            >
              <AppText style={[styles.balanceName, directionHelpers.text]} variant="callout">
                {leaveType}
              </AppText>
              <AppText style={directionHelpers.text} variant="headline">
                {remaining}
              </AppText>
            </View>
          );
        })}
      </View>
    </Card>
  );
}

function AnnouncementsCard({
  onOpenAll,
  section,
  retry,
}: {
  onOpenAll: () => void;
  section: HomeSection<AnnouncementPreview[]>;
  retry: () => void;
}) {
  const localization = useLocalization();
  const { t } = localization;

  if (section.status === 'error') {
    return <ResourceFailure compact kind={section.kind} onRetry={retry} />;
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
  const { isLoading, isRefreshing, refresh, retry, snapshot } = useHomeDashboard();

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
        <ResourceFailure kind={kind} onRetry={retry} />
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

      <AttendanceCard retry={retry} section={snapshot.attendance} />
      <LeaveBalanceCard retry={retry} section={snapshot.leaveBalances} />
      <AnnouncementsCard
        onOpenAll={() => router.push('/notifications')}
        retry={retry}
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
  balanceList: {
    gap: spacing.md,
    marginTop: spacing.lg,
  },
  balanceRow: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    paddingBottom: spacing.sm,
  },
  balanceName: {
    flex: 1,
  },
  announcementList: {
    marginTop: spacing.lg,
  },
  separated: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
});
