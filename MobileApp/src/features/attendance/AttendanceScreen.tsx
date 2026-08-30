import { useCallback, useState } from 'react';
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
  SkeletonList,
  StatusBadge,
} from '@/components/ui';
import { colors, spacing } from '@/design-system';
import { useLocalization } from '@/i18n';
import { useAuth } from '@/providers';
import { requireLocalAuthentication, type Reauthenticate } from '@/services/biometrics';

import {
  attendanceStatusPresentation,
  formatDateValue,
  formatTimeValue,
  ResourceFailure,
  useResource,
} from '../shared';

import { attendanceDayState, checkIn, checkOut, loadAttendanceTimeline } from './attendance-api';
import type { AttendanceActionOutcome, AttendanceRecord, AttendanceTimeline } from './types';

const DAY_STATE_LABEL = {
  'not-checked-in': 'attendance.notCheckedIn',
  'checked-in': 'attendance.checkedIn',
  'checked-out': 'attendance.checkedOut',
} as const;

const DAY_STATE_TONE = {
  'not-checked-in': 'neutral',
  'checked-in': 'success',
  'checked-out': 'info',
} as const;

function AttendanceRow({ item }: { item: AttendanceRecord }) {
  const localization = useLocalization();
  const { t } = localization;
  const status = attendanceStatusPresentation(item.status);
  const window = `${t('attendance.checkInTime')} ${formatTimeValue(localization, item.checkInAt)} · ${t('attendance.checkOutTime')} ${formatTimeValue(localization, item.checkOutAt)}`;

  return (
    <ListRow
      meta={status ? `${t('attendance.approvalState')}: ${t(status.labelKey)}` : undefined}
      subtitle={window}
      title={formatDateValue(localization, item.date)}
      trailing={
        status ? (
          <StatusBadge glyph={status.glyph} label={t(status.labelKey)} tone={status.tone} />
        ) : null
      }
    />
  );
}

function TodayCard({
  busy,
  onCheckIn,
  onCheckOut,
  timeline,
}: {
  busy: 'check-in' | 'check-out' | null;
  onCheckIn: () => void;
  onCheckOut: () => void;
  timeline: AttendanceTimeline;
}) {
  const localization = useLocalization();
  const { directionHelpers, t } = localization;
  const dayState = attendanceDayState(timeline.today);
  const statusLabel = t(DAY_STATE_LABEL[dayState]);

  return (
    <Card accessibilityLabel={`${t('attendance.status')}: ${statusLabel}`} elevated>
      <View style={[styles.todayHeader, directionHelpers.row]}>
        <View style={styles.todayCopy}>
          <AppText style={directionHelpers.text} tone="muted" variant="footnote">
            {t('attendance.todayLabel')}
          </AppText>
          <AppText accessibilityRole="header" style={directionHelpers.text} variant="title2">
            {statusLabel}
          </AppText>
          <StatusBadge
            glyph={dayState === 'not-checked-in' ? '–' : '✓'}
            label={statusLabel}
            tone={DAY_STATE_TONE[dayState]}
          />
        </View>
        <AttendancePulse />
      </View>

      <View style={[styles.stamps, directionHelpers.row]}>
        <View style={styles.stamp}>
          <AppText style={directionHelpers.text} tone="muted" variant="footnote">
            {t('attendance.checkInTime')}
          </AppText>
          <AppText style={directionHelpers.text} variant="headline">
            {formatTimeValue(localization, timeline.today?.checkInAt ?? null)}
          </AppText>
        </View>
        <View style={styles.stampDivider} />
        <View style={styles.stamp}>
          <AppText style={directionHelpers.text} tone="muted" variant="footnote">
            {t('attendance.checkOutTime')}
          </AppText>
          <AppText style={directionHelpers.text} variant="headline">
            {formatTimeValue(localization, timeline.today?.checkOutAt ?? null)}
          </AppText>
        </View>
      </View>

      <View style={styles.actions}>
        <Button
          accessibilityHint={t('attendance.checkIn')}
          disabled={dayState !== 'not-checked-in' || busy !== null}
          fullWidth
          label={busy === 'check-in' ? t('attendance.checkingIn') : t('attendance.checkIn')}
          loading={busy === 'check-in'}
          onPress={onCheckIn}
          testID="attendance-check-in"
        />
        <Button
          accessibilityHint={t('attendance.checkOut')}
          disabled={dayState !== 'checked-in' || busy !== null}
          fullWidth
          label={busy === 'check-out' ? t('attendance.checkingOut') : t('attendance.checkOut')}
          loading={busy === 'check-out'}
          onPress={onCheckOut}
          testID="attendance-check-out"
          variant="secondary"
        />
      </View>
    </Card>
  );
}

export function AttendanceScreen({
  /** Injectable so tests exercise the gate without the native prompt. */
  reauthenticate = requireLocalAuthentication,
}: { reauthenticate?: Reauthenticate } = {}) {
  const { handleApiError } = useAuth();
  const { t } = useLocalization();
  const [busy, setBusy] = useState<'check-in' | 'check-out' | null>(null);
  const [outcome, setOutcome] = useState<AttendanceActionOutcome | null>(null);
  const { isRefreshing, refresh, resource, retry } = useResource<AttendanceTimeline>(
    useCallback(() => loadAttendanceTimeline(), []),
  );

  const runAction = useCallback(
    async (kind: 'check-in' | 'check-out') => {
      if (busy) return;
      setBusy(kind);
      setOutcome(null);
      try {
        // Gate 4: attendance is a protected operation, so the device owner is
        // re-verified before any location is captured or any request is sent.
        const reauth = await reauthenticate({
          promptMessage: t('lock.attendancePrompt'),
          cancelLabel: t('common.cancel'),
        });
        if (reauth.status !== 'passed') {
          setOutcome({
            status: 'failed',
            messageKey:
              reauth.reason === 'unavailable' ? 'lock.unprotectedBody' : 'lock.attendanceFailed',
          });
          return;
        }
        const result = kind === 'check-in' ? await checkIn() : await checkOut();
        setOutcome(result);
        if (result.status === 'success') await refresh();
      } catch (error) {
        if (!handleApiError(error))
          setOutcome({ status: 'failed', messageKey: 'state.actionFailed' });
      } finally {
        setBusy(null);
      }
    },
    [busy, handleApiError, reauthenticate, refresh, t],
  );

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
      <ScreenHeader subtitle={t('attendance.subtitle')} title={t('attendance.title')} />

      {resource.status === 'loading' ? (
        <SkeletonList rows={4} testID="attendance-skeleton" />
      ) : null}

      {resource.status === 'error' ? (
        <ResourceFailure kind={resource.kind} onRetry={() => void retry()} />
      ) : null}

      {resource.status === 'ready' ? (
        <>
          <TodayCard
            busy={busy}
            onCheckIn={() => void runAction('check-in')}
            onCheckOut={() => void runAction('check-out')}
            timeline={resource.data}
          />

          {outcome ? (
            <AppText
              accessibilityLiveRegion="polite"
              testID="attendance-outcome"
              tone={outcome.status === 'success' ? 'success' : 'error'}
              variant="subhead"
            >
              {outcome.status === 'success'
                ? t(
                    outcome.kind === 'check-in'
                      ? 'attendance.checkInDone'
                      : 'attendance.checkOutDone',
                  )
                : t(outcome.messageKey)}
            </AppText>
          ) : null}

          <View style={styles.historySection}>
            <SectionHeader hint={t('attendance.historyHint')} title={t('attendance.history')} />
            {resource.data.records.length === 0 ? (
              <EmptyState
                compact
                emoji="🗓️"
                message={t('attendance.noHistory')}
                title={t('state.emptyTitle')}
              />
            ) : (
              <Card>
                <View accessibilityRole="list" style={styles.list}>
                  {resource.data.records.map((item, index) => (
                    <View
                      key={String(item.id ?? `${item.date ?? 'record'}-${index}`)}
                      style={index > 0 ? styles.separated : undefined}
                    >
                      <AttendanceRow item={item} />
                    </View>
                  ))}
                </View>
              </Card>
            )}
          </View>
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
  todayHeader: {
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.lg,
  },
  todayCopy: {
    flex: 1,
    gap: spacing.xs,
    alignItems: 'flex-start',
  },
  stamps: {
    alignItems: 'center',
    marginTop: spacing.xl,
    gap: spacing.lg,
  },
  stamp: {
    flex: 1,
    gap: spacing.xxs,
  },
  stampDivider: {
    width: StyleSheet.hairlineWidth,
    alignSelf: 'stretch',
    backgroundColor: colors.border,
  },
  actions: {
    marginTop: spacing.xl,
    gap: spacing.md,
  },
  historySection: {
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
