import { useCallback } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText, DetailRow, DetailSheet, SkeletonCard, StatusBadge } from '@/components/ui';
import { spacing } from '@/design-system';
import { useLocalization } from '@/i18n';

import {
  employmentStatusPresentation,
  formatDateValue,
  ResourceFailure,
  useResource,
} from '../shared';

import { loadProfile } from './more-api';
import type { EmployeeProfileSummary } from './types';

interface ProfileSheetProps {
  onClose: () => void;
}

function ProfileBody({ profile }: { profile: EmployeeProfileSummary }) {
  const localization = useLocalization();
  const { directionHelpers, t } = localization;
  const status = employmentStatusPresentation(profile.employmentStatus);
  const fallback = t('common.notAvailable');

  return (
    <>
      <View style={styles.identity}>
        <AppText accessibilityRole="header" style={directionHelpers.text} variant="title2">
          {profile.fullName ?? fallback}
        </AppText>
        {status ? (
          <StatusBadge glyph={status.glyph} label={t(status.labelKey)} tone={status.tone} />
        ) : null}
      </View>

      <View style={styles.rows}>
        <DetailRow label={t('profile.employeeId')} value={profile.employeeNumber ?? fallback} />
        <DetailRow label={t('profile.email')} value={profile.email ?? fallback} />
        <DetailRow label={t('profile.mobile')} value={profile.mobile ?? fallback} />
        <DetailRow label={t('profile.company')} value={profile.companyName ?? fallback} />
        <DetailRow label={t('profile.department')} value={profile.department ?? fallback} />
        <DetailRow label={t('profile.position')} value={profile.position ?? fallback} />
        <DetailRow label={t('profile.manager')} value={profile.managerName ?? fallback} />
        <DetailRow label={t('profile.nationality')} value={profile.nationality ?? fallback} />
        <DetailRow
          label={t('profile.hireDate')}
          value={formatDateValue(localization, profile.hireDate)}
        />
        <DetailRow
          label={t('profile.contractExpiry')}
          value={formatDateValue(localization, profile.contractExpiry)}
        />
      </View>

      <AppText style={directionHelpers.text} tone="muted" variant="footnote">
        {t('profile.sensitiveNotice')}
      </AppText>
    </>
  );
}

/**
 * Mounted only while open. Unmounting discards the fetched profile, so identity data
 * is never retained after the screen is dismissed.
 */
export function ProfileSheet({ onClose }: ProfileSheetProps) {
  const { t } = useLocalization();
  const { resource, retry } = useResource<EmployeeProfileSummary>(
    useCallback(() => loadProfile(), []),
  );

  return (
    <DetailSheet onClose={onClose} testID="profile-sheet" title={t('profile.title')} visible>
      {resource.status === 'loading' ? <SkeletonCard testID="profile-skeleton" /> : null}
      {resource.status === 'error' ? (
        <ResourceFailure kind={resource.kind} onRetry={() => void retry()} />
      ) : null}
      {resource.status === 'ready' ? <ProfileBody profile={resource.data} /> : null}
    </DetailSheet>
  );
}

const styles = StyleSheet.create({
  identity: {
    gap: spacing.sm,
    alignItems: 'flex-start',
  },
  rows: {
    gap: spacing.md,
  },
});
