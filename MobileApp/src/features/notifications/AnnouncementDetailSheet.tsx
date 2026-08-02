import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText, DetailRow, DetailSheet, SkeletonCard } from '@/components/ui';
import { colors, radii, spacing } from '@/design-system';
import { useLocalization } from '@/i18n';
import { useAuth } from '@/providers';
import { ApiError } from '@/services/api';

import { formatDateTimeValue, loadResource, ResourceFailure, type Resource } from '../shared';

import { loadAnnouncementDetail } from './notifications-api';
import type { AnnouncementDetail, AnnouncementItem } from './types';

interface AnnouncementDetailSheetProps {
  announcement: AnnouncementItem | null;
  onClose: () => void;
}

/**
 * Detail is fetched on demand from the verified detail route and held only in local
 * state; the record identifier never becomes a route or query parameter.
 */
export function AnnouncementDetailSheet({ announcement, onClose }: AnnouncementDetailSheetProps) {
  const { handleApiError } = useAuth();
  const localization = useLocalization();
  const { directionHelpers, t } = localization;
  const announcementId = announcement?.id ?? null;
  /**
   * The loaded id is stored with the payload so a stale response for a previously
   * selected announcement can never be rendered under a different title.
   */
  const [loaded, setLoaded] = useState<{
    id: number | string | null;
    attempt: number;
    resource: Resource<AnnouncementDetail>;
  }>({ id: null, attempt: 0, resource: { status: 'loading' } });
  /** Bumping this re-runs the effect, which is how retry issues a fresh request. */
  const [attempt, setAttempt] = useState(0);
  const detail: Resource<AnnouncementDetail> =
    loaded.id !== null && loaded.id === announcementId && loaded.attempt === attempt
      ? loaded.resource
      : { status: 'loading' };

  useEffect(() => {
    if (announcementId === null) return;
    let active = true;
    void loadResource(() => loadAnnouncementDetail(announcementId)).then((resource) => {
      if (!active) return;
      setLoaded({ id: announcementId, attempt, resource });
      if (resource.status === 'error' && resource.kind === 'session-expired') {
        handleApiError(new ApiError('session_expired', 401));
      }
    });
    return () => {
      active = false;
    };
  }, [announcementId, attempt, handleApiError]);

  const retry = useCallback(() => setAttempt((current) => current + 1), []);
  const close = useCallback(() => {
    setAttempt(0);
    onClose();
  }, [onClose]);

  return (
    <DetailSheet
      onClose={close}
      testID="announcement-detail"
      title={announcement?.title ?? t('announcements.detail')}
      visible={announcement !== null}
    >
      {detail.status === 'loading' ? <SkeletonCard testID="announcement-detail-skeleton" /> : null}
      {detail.status === 'error' ? (
        <ResourceFailure compact kind={detail.kind} onRetry={retry} />
      ) : null}
      {detail.status === 'ready' ? (
        <>
          <View style={styles.meta}>
            <DetailRow
              label={t('announcements.publishedOn')}
              value={formatDateTimeValue(localization, detail.data.createdAt)}
            />
            <DetailRow
              label={t('announcements.publishedBy')}
              value={detail.data.createdByName ?? t('common.notAvailable')}
            />
          </View>
          <AppText style={directionHelpers.text} variant="body">
            {detail.data.content ?? detail.data.contentPreview ?? t('common.notAvailable')}
          </AppText>
          {detail.data.hasAttachment ? (
            <View style={styles.notice} testID="announcement-attachment-notice">
              <AppText style={directionHelpers.text} tone="warning" variant="footnote">
                {t('announcements.attachmentNotice')}
              </AppText>
            </View>
          ) : null}
        </>
      ) : null}
    </DetailSheet>
  );
}

const styles = StyleSheet.create({
  meta: {
    gap: spacing.md,
  },
  notice: {
    borderWidth: 1,
    borderColor: colors.warning,
    backgroundColor: colors.warningSoft,
    borderRadius: radii.md,
    padding: spacing.lg,
  },
});
