import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import {
  AppText,
  Card,
  DetailRow,
  DetailSheet,
  EmptyState,
  ListRow,
  SkeletonList,
} from '@/components/ui';
import { colors, radii, spacing } from '@/design-system';
import { useLocalization } from '@/i18n';

import { documentTypeKey, formatDateValue, ResourceFailure, useResource } from '../shared';

import { loadDocuments } from './more-api';
import type { EmployeeDocumentSummary } from './types';

interface DocumentsSheetProps {
  onClose: () => void;
}

function documentTitle(
  document: EmployeeDocumentSummary,
  t: ReturnType<typeof useLocalization>['t'],
): string {
  const typeKey = documentTypeKey(document.documentType);
  return document.displayName ?? (typeKey ? t(typeKey) : t('common.notAvailable'));
}

function DocumentDetailSheet({
  document,
  onClose,
}: {
  document: EmployeeDocumentSummary;
  onClose: () => void;
}) {
  const localization = useLocalization();
  const { directionHelpers, t } = localization;
  const typeKey = documentTypeKey(document.documentType);

  return (
    <DetailSheet
      onClose={onClose}
      testID="document-detail"
      title={documentTitle(document, t)}
      visible
    >
      <View style={styles.rows}>
        <DetailRow
          label={t('documents.type')}
          value={typeKey ? t(typeKey) : t('common.notAvailable')}
        />
        <DetailRow
          label={t('documents.uploaded')}
          value={formatDateValue(localization, document.createdAt)}
        />
        <DetailRow
          label={t('documents.expiry')}
          value={formatDateValue(localization, document.expiresAt)}
        />
      </View>
      <View style={styles.notice} testID="document-download-notice">
        <AppText style={directionHelpers.text} tone="warning" variant="footnote">
          {t('documents.downloadUnavailable')}
        </AppText>
      </View>
    </DetailSheet>
  );
}

/**
 * Mounted only while open. The list carries metadata only — the server keeps the file
 * field write-only, so no document URL or content is ever held by the client.
 */
export function DocumentsSheet({ onClose }: DocumentsSheetProps) {
  const localization = useLocalization();
  const { t } = localization;
  const [selected, setSelected] = useState<EmployeeDocumentSummary | null>(null);
  const { resource, retry } = useResource<EmployeeDocumentSummary[]>(
    useCallback(() => loadDocuments(), []),
  );

  return (
    <>
      <DetailSheet
        onClose={onClose}
        testID="documents-sheet"
        title={t('documents.title')}
        visible={selected === null}
      >
        {resource.status === 'loading' ? (
          <SkeletonList rows={3} testID="documents-skeleton" />
        ) : null}
        {resource.status === 'error' ? (
          <ResourceFailure kind={resource.kind} onRetry={() => void retry()} />
        ) : null}
        {resource.status === 'ready' && resource.data.length === 0 ? (
          <EmptyState
            emoji="📁"
            message={t('documents.noDocuments')}
            title={t('documents.title')}
          />
        ) : null}
        {resource.status === 'ready' && resource.data.length > 0 ? (
          <Card>
            <View accessibilityRole="list" style={styles.list}>
              {resource.data.map((document, index) => {
                const typeKey = documentTypeKey(document.documentType);
                return (
                  <View
                    key={String(document.id ?? `${document.createdAt ?? 'document'}-${index}`)}
                    style={index > 0 ? styles.separated : undefined}
                  >
                    <ListRow
                      accessibilityHint={t('accessibility.opensDetailHint')}
                      meta={
                        document.expiresAt
                          ? `${t('documents.expiry')}: ${formatDateValue(localization, document.expiresAt)}`
                          : undefined
                      }
                      onPress={() => setSelected(document)}
                      subtitle={typeKey ? t(typeKey) : undefined}
                      testID={`document-${document.id ?? index}`}
                      title={documentTitle(document, t)}
                    />
                  </View>
                );
              })}
            </View>
          </Card>
        ) : null}
      </DetailSheet>

      {selected ? (
        <DocumentDetailSheet document={selected} onClose={() => setSelected(null)} />
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  rows: {
    gap: spacing.md,
  },
  list: {
    gap: spacing.xs,
  },
  separated: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  notice: {
    borderWidth: 1,
    borderColor: colors.warning,
    backgroundColor: colors.warningSoft,
    borderRadius: radii.md,
    padding: spacing.lg,
  },
});
