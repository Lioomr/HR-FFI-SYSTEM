import { useCallback, useEffect, useState } from 'react';
import { Pressable, RefreshControl, StyleSheet, View } from 'react-native';

import { createTabAccessibility } from '@/accessibility';
import {
  AppText,
  Button,
  Card,
  DetailRow,
  DetailSheet,
  EmptyState,
  ListRow,
  Screen,
  ScreenHeader,
  SkeletonList,
  StatusBadge,
} from '@/components/ui';
import { colors, layout, radii, spacing } from '@/design-system';
import { useLocalization, type TranslationKey } from '@/i18n';
import { useAuth, useNotificationPolling } from '@/providers';

import {
  formatDateTimeValue,
  localizedCount,
  ResourceFailure,
  useResource,
  type Resource,
} from '../shared';

import { AnnouncementDetailSheet } from './AnnouncementDetailSheet';
import {
  loadAnnouncements,
  loadNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from './notifications-api';
import type {
  AnnouncementItem,
  NotificationItem,
  NotificationPage,
  NotificationsTab,
} from './types';

const TABS: readonly { key: NotificationsTab; labelKey: TranslationKey }[] = [
  { key: 'notifications', labelKey: 'notifications.tabNotifications' },
  { key: 'announcements', labelKey: 'notifications.tabAnnouncements' },
];

function SegmentedTabs({
  active,
  onChange,
}: {
  active: NotificationsTab;
  onChange: (tab: NotificationsTab) => void;
}) {
  const { directionHelpers, t } = useLocalization();

  return (
    <View accessibilityRole="tablist" style={[styles.segments, directionHelpers.row]}>
      {TABS.map((tab) => {
        const selected = tab.key === active;
        return (
          <Pressable
            {...createTabAccessibility({ label: t(tab.labelKey), selected })}
            key={tab.key}
            onPress={() => onChange(tab.key)}
            style={({ pressed }) => [
              styles.segment,
              selected && styles.segmentSelected,
              pressed && styles.segmentPressed,
            ]}
            testID={`notifications-tab-${tab.key}`}
          >
            <AppText
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              variant={selected ? 'headline' : 'callout'}
            >
              {t(tab.labelKey)}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

function NotificationDetailSheet({
  notification,
  onClose,
}: {
  notification: NotificationItem | null;
  onClose: () => void;
}) {
  const localization = useLocalization();
  const { directionHelpers, t } = localization;

  return (
    <DetailSheet
      onClose={onClose}
      testID="notification-detail"
      title={notification?.title ?? t('notifications.detail')}
      visible={notification !== null}
    >
      <DetailRow
        label={t('notifications.receivedOn')}
        value={formatDateTimeValue(localization, notification?.createdAt ?? null)}
      />
      <StatusBadge
        glyph={notification?.isRead ? '✓' : '•'}
        label={notification?.isRead ? t('notifications.read') : t('notifications.unread')}
        tone={notification?.isRead ? 'neutral' : 'info'}
      />
      <AppText style={directionHelpers.text} variant="body">
        {notification?.message ?? t('common.notAvailable')}
      </AppText>
    </DetailSheet>
  );
}

function NotificationList({
  onSelect,
  section,
}: {
  onSelect: (notification: NotificationItem) => void;
  section: Resource<NotificationPage>;
}) {
  const localization = useLocalization();
  const { t } = localization;

  if (section.status === 'loading')
    return <SkeletonList rows={4} testID="notifications-skeleton" />;
  if (section.status === 'error') return <ResourceFailure kind={section.kind} />;
  if (section.data.items.length === 0) {
    return (
      <EmptyState
        emoji="🔔"
        message={t('notifications.noNotifications')}
        title={t('notifications.title')}
      />
    );
  }

  return (
    <Card>
      <View accessibilityRole="list" style={styles.list}>
        {section.data.items.map((item, index) => (
          <View
            key={String(item.id ?? `${item.createdAt ?? 'notification'}-${index}`)}
            style={index > 0 ? styles.separated : undefined}
          >
            <ListRow
              accessibilityHint={t('accessibility.opensDetailHint')}
              accessibilityLabel={[
                item.isRead ? t('notifications.read') : t('notifications.unread'),
                item.title,
                item.message,
              ]
                .filter(Boolean)
                .join('. ')}
              emphasized={!item.isRead}
              meta={formatDateTimeValue(localization, item.createdAt)}
              onPress={() => onSelect(item)}
              subtitle={item.message ?? undefined}
              testID={`notification-${item.id ?? index}`}
              title={item.title ?? t('common.notAvailable')}
              trailing={
                item.isRead ? null : (
                  <StatusBadge glyph="•" label={t('notifications.unread')} tone="info" />
                )
              }
            />
          </View>
        ))}
      </View>
    </Card>
  );
}

function AnnouncementList({
  onSelect,
  section,
}: {
  onSelect: (announcement: AnnouncementItem) => void;
  section: Resource<AnnouncementItem[]>;
}) {
  const localization = useLocalization();
  const { t } = localization;

  if (section.status === 'loading')
    return <SkeletonList rows={3} testID="announcements-skeleton" />;
  if (section.status === 'error') return <ResourceFailure kind={section.kind} />;
  if (section.data.length === 0) {
    return (
      <EmptyState
        emoji="📣"
        message={t('announcements.noAnnouncements')}
        title={t('announcements.title')}
      />
    );
  }

  return (
    <Card>
      <View accessibilityRole="list" style={styles.list}>
        {section.data.map((item, index) => (
          <View
            key={String(item.id ?? `${item.createdAt ?? 'announcement'}-${index}`)}
            style={index > 0 ? styles.separated : undefined}
          >
            <ListRow
              accessibilityHint={t('accessibility.opensDetailHint')}
              meta={formatDateTimeValue(localization, item.createdAt)}
              onPress={() => onSelect(item)}
              subtitle={item.contentPreview ?? undefined}
              testID={`announcement-${item.id ?? index}`}
              title={item.title ?? t('common.notAvailable')}
              trailing={
                item.hasAttachment ? (
                  <StatusBadge glyph="📎" label={t('common.details')} tone="neutral" />
                ) : null
              }
            />
          </View>
        ))}
      </View>
    </Card>
  );
}

export function NotificationsScreen() {
  const { handleApiError } = useAuth();
  const { refresh: refreshUnreadCount, unreadCount } = useNotificationPolling();
  const localization = useLocalization();
  const { t } = localization;
  const [tab, setTab] = useState<NotificationsTab>('notifications');
  const [selectedNotification, setSelectedNotification] = useState<NotificationItem | null>(null);
  const [selectedAnnouncement, setSelectedAnnouncement] = useState<AnnouncementItem | null>(null);
  const [markingAll, setMarkingAll] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const notifications = useResource<NotificationPage>(useCallback(() => loadNotifications(), []));
  const announcements = useResource<AnnouncementItem[]>(useCallback(() => loadAnnouncements(), []));

  const isRefreshing = notifications.isRefreshing || announcements.isRefreshing;
  const refreshAll = useCallback(async () => {
    await Promise.all([notifications.refresh(), announcements.refresh(), refreshUnreadCount()]);
  }, [announcements, notifications, refreshUnreadCount]);

  useEffect(() => {
    if (selectedNotification === null || selectedNotification.isRead) return;
    const id = selectedNotification.id;
    if (id === null) return;
    let active = true;
    void markNotificationRead(id)
      .then((result) => {
        if (!active || result !== 'success') return;
        notifications.replace((page) => ({
          ...page,
          items: page.items.map((item) =>
            item.id === id ? { ...item, isRead: true, readAt: item.readAt } : item,
          ),
          unreadCount: Math.max(0, page.unreadCount - 1),
        }));
        setSelectedNotification((current) =>
          current && current.id === id ? { ...current, isRead: true } : current,
        );
        void refreshUnreadCount();
      })
      .catch((error: unknown) => {
        if (active) handleApiError(error);
      });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedNotification?.id, selectedNotification?.isRead]);

  const markAll = useCallback(async () => {
    if (markingAll) return;
    setMarkingAll(true);
    setActionError(null);
    try {
      const result = await markAllNotificationsRead();
      if (result !== 'success') {
        setActionError(t('state.actionFailed'));
        return;
      }
      await Promise.all([notifications.refresh(), refreshUnreadCount()]);
    } catch (error) {
      if (!handleApiError(error)) setActionError(t('state.actionFailed'));
    } finally {
      setMarkingAll(false);
    }
  }, [handleApiError, markingAll, notifications, refreshUnreadCount, t]);

  const unreadLabel =
    unreadCount > 0
      ? localizedCount(localization, 'notifications.unreadCount', unreadCount)
      : t('notifications.allRead');

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
            onRefresh={() => void refreshAll()}
            refreshing={isRefreshing}
            tintColor={colors.text}
          />
        ),
      }}
    >
      <ScreenHeader subtitle={t('notifications.subtitle')} title={t('notifications.title')} />

      <View
        accessibilityLiveRegion="polite"
        accessibilityRole="text"
        testID="notifications-summary"
      >
        <AppText tone={unreadCount > 0 ? 'default' : 'muted'} variant="headline">
          {unreadLabel}
        </AppText>
      </View>

      <SegmentedTabs active={tab} onChange={setTab} />

      {actionError ? (
        <AppText accessibilityLiveRegion="assertive" tone="error" variant="subhead">
          {actionError}
        </AppText>
      ) : null}

      {tab === 'notifications' ? (
        <>
          {unreadCount > 0 ? (
            <Button
              accessibilityLabel={
                markingAll ? t('notifications.markingRead') : t('notifications.markAllRead')
              }
              fullWidth
              label={t('notifications.markAllRead')}
              loading={markingAll}
              onPress={() => void markAll()}
              size="compact"
              testID="notifications-mark-all"
              variant="secondary"
            />
          ) : null}
          <NotificationList onSelect={setSelectedNotification} section={notifications.resource} />
        </>
      ) : (
        <AnnouncementList onSelect={setSelectedAnnouncement} section={announcements.resource} />
      )}

      <NotificationDetailSheet
        notification={selectedNotification}
        onClose={() => setSelectedNotification(null)}
      />
      <AnnouncementDetailSheet
        announcement={selectedAnnouncement}
        onClose={() => setSelectedAnnouncement(null)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: spacing.lg,
    paddingBottom: spacing.section,
  },
  segments: {
    gap: spacing.sm,
    padding: spacing.xs,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  segment: {
    flex: 1,
    minHeight: layout.minTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.sm,
    paddingHorizontal: spacing.md,
  },
  segmentSelected: {
    backgroundColor: colors.primarySoft,
    borderWidth: 1,
    borderColor: colors.text,
  },
  segmentPressed: {
    opacity: 0.76,
  },
  list: {
    gap: spacing.xs,
  },
  separated: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
});
