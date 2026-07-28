import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { RefreshControl, StyleSheet, View } from 'react-native';

import { useLocalization } from '@/i18n';
import { useAuth } from '@/providers/AuthProvider';
import { ApiError } from '@/services/api';
import { colors, radii, spacing } from '@/design-system';
import {
  AppText,
  AttendancePulse,
  Button,
  Card,
  EmptyState,
  ErrorState,
  LoadingState,
  OfflineState,
  Screen,
  SessionExpiredState,
} from '@/components/ui';

import type {
  AnnouncementPreview,
  AttendanceRecordPreview,
  HomeSection,
  LeaveBalancePreview,
} from './types';
import { useHomeDashboard } from './useHomeDashboard';

type Translate = ReturnType<typeof useLocalization>['t'];

function SectionHeading({ children }: { children: string }) {
  return (
    <AppText accessibilityRole="header" variant="title2">
      {children}
    </AppText>
  );
}

function SectionFailure({ kind, retry, t }: { kind: string; retry: () => void; t: Translate }) {
  const action = (
    <Button
      accessibilityHint={t('accessibility.retryHint')}
      fullWidth
      label={t('common.retry')}
      onPress={retry}
      size="compact"
      variant="secondary"
    />
  );

  if (kind === 'offline') {
    return (
      <OfflineState
        action={action}
        compact
        message={t('state.offlineBody')}
        title={t('state.offlineTitle')}
      />
    );
  }
  if (kind === 'session-expired') {
    return (
      <SessionExpiredState
        compact
        message={t('state.sessionExpiredBody')}
        title={t('state.sessionExpiredTitle')}
      />
    );
  }
  return (
    <ErrorState
      action={action}
      compact
      message={t('state.errorBody')}
      title={t('state.errorTitle')}
    />
  );
}

function safeFormat(
  value: string | null,
  formatter: (input: string) => string,
  unavailable: string,
): string {
  if (!value) return unavailable;
  try {
    return formatter(value);
  } catch {
    return unavailable;
  }
}

function localizedCount(
  value: number,
  key: 'leave.availableDays' | 'notifications.unreadCount',
  t: Translate,
  formatNumber: (input: number) => string,
): string {
  return t(key, { count: value }).replace(String(value), formatNumber(value));
}

function AttendanceCard({
  section,
  retry,
}: {
  section: HomeSection<AttendanceRecordPreview[]>;
  retry: () => void;
}) {
  const { directionHelpers, formatDate, formatTime, t } = useLocalization();
  if (section.status === 'error') {
    return <SectionFailure kind={section.kind} retry={retry} t={t} />;
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
          <SectionHeading>{t('dashboard.attendanceStatus')}</SectionHeading>
          <AppText variant="headline">{statusLabel}</AppText>
        </View>
        <AttendancePulse compact />
      </View>
      <View accessibilityRole="list" style={styles.timeline}>
        {section.data.slice(0, 3).map((record, index) => (
          <View
            accessibilityRole="text"
            key={String(record.id ?? `${record.date ?? 'record'}-${index}`)}
            style={[styles.timelineRow, directionHelpers.row]}
          >
            <View style={styles.timelineMarker} />
            <AppText style={[styles.timelineDate, directionHelpers.text]} variant="subhead">
              {safeFormat(record.date, (date) => formatDate(date), t('common.notAvailable'))}
            </AppText>
            <AppText style={directionHelpers.text} tone="muted" variant="footnote">
              {safeFormat(record.checkInAt, (time) => formatTime(time), t('common.notAvailable'))}
              {' – '}
              {safeFormat(record.checkOutAt, (time) => formatTime(time), t('common.notAvailable'))}
            </AppText>
          </View>
        ))}
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
  const { directionHelpers, formatNumber, t } = useLocalization();
  if (section.status === 'error') {
    return <SectionFailure kind={section.kind} retry={retry} t={t} />;
  }
  if (section.data.length === 0) {
    return (
      <EmptyState
        compact
        emoji="🌴"
        message={t('state.emptyBody')}
        title={t('dashboard.leaveBalance')}
      />
    );
  }
  return (
    <Card>
      <SectionHeading>{t('dashboard.leaveBalance')}</SectionHeading>
      <View accessibilityRole="list" style={styles.balanceList}>
        {section.data.map((balance, index) => {
          const leaveType = balance.leaveType ?? t('common.notAvailable');
          const remaining =
            balance.remainingDays === null
              ? t('common.notAvailable')
              : localizedCount(balance.remainingDays, 'leave.availableDays', t, formatNumber);
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
  section,
  retry,
}: {
  section: HomeSection<AnnouncementPreview[]>;
  retry: () => void;
}) {
  const { directionHelpers, formatDate, t } = useLocalization();
  if (section.status === 'error') {
    return <SectionFailure kind={section.kind} retry={retry} t={t} />;
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
      <SectionHeading>{t('dashboard.announcements')}</SectionHeading>
      <View accessibilityRole="list" style={styles.announcementList}>
        {section.data.map((announcement, index) => (
          <View
            accessibilityRole="text"
            key={String(announcement.id ?? `${announcement.createdAt ?? 'announcement'}-${index}`)}
            style={styles.announcement}
          >
            <AppText style={directionHelpers.text} variant="headline">
              {announcement.title ?? t('common.notAvailable')}
            </AppText>
            <AppText numberOfLines={2} style={directionHelpers.text} tone="muted" variant="subhead">
              {announcement.contentPreview ?? t('common.notAvailable')}
            </AppText>
            <AppText style={directionHelpers.text} tone="muted" variant="caption">
              {safeFormat(
                announcement.createdAt,
                (date) => formatDate(date),
                t('common.notAvailable'),
              )}
            </AppText>
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
  const { directionHelpers, formatNumber, t } = useLocalization();
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
      <Screen>
        <LoadingState message={t('state.loadingBody')} title={t('state.loadingTitle')} />
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
        <SectionFailure kind={kind} retry={retry} t={t} />
      </Screen>
    );
  }

  const name = user?.full_name?.trim() || user?.email || t('dashboard.welcome');
  const unread =
    snapshot.unreadNotifications.status === 'ready'
      ? localizedCount(
          snapshot.unreadNotifications.data,
          'notifications.unreadCount',
          t,
          formatNumber,
        )
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
          <AppText accessibilityRole="header" style={directionHelpers.text} variant="title1">
            {t('dashboard.greeting', { name })}
          </AppText>
          <AppText style={directionHelpers.text} tone="muted" variant="subhead">
            {unread}
          </AppText>
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
      <AnnouncementsCard retry={retry} section={snapshot.announcements} />
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
    gap: spacing.xs,
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
  announcement: {
    gap: spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    paddingVertical: spacing.md,
  },
});
