import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import {
  AppText,
  Card,
  DetailRow,
  DetailSheet,
  EmptyState,
  ListRow,
  SkeletonCard,
  SkeletonList,
  StatusBadge,
} from '@/components/ui';
import { colors, radii, spacing } from '@/design-system';
import { useLocalization } from '@/i18n';
import { useAuth } from '@/providers';
import { ApiError } from '@/services/api';

import {
  formatCurrencyValue,
  loadResource,
  payslipStatusPresentation,
  ResourceFailure,
  useResource,
  type Resource,
} from '../shared';

import { loadPayslipDetail, loadPayslips } from './more-api';
import type { PayslipDetail, PayslipSummary } from './types';

interface PayslipsSheetProps {
  onClose: () => void;
}

function periodLabel(
  payslip: Pick<PayslipSummary, 'month' | 'year'>,
  localization: ReturnType<typeof useLocalization>,
): string {
  const { formatDate, t } = localization;
  if (payslip.year === null || payslip.month === null) return t('common.notAvailable');
  try {
    return formatDate(new Date(Date.UTC(payslip.year, payslip.month - 1, 1)), {
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    });
  } catch {
    return t('payslips.period', { month: payslip.month, year: payslip.year });
  }
}

function PayslipDetailSheet({
  onClose,
  payslip,
}: {
  onClose: () => void;
  payslip: PayslipSummary;
}) {
  const { handleApiError } = useAuth();
  const localization = useLocalization();
  const { directionHelpers, t } = localization;
  const [detail, setDetail] = useState<Resource<PayslipDetail>>({ status: 'loading' });
  /** Bumping this re-runs the effect, which is how retry issues a fresh request. */
  const [attempt, setAttempt] = useState(0);
  const requestId = useRef(0);
  const payslipId = payslip.id;

  useEffect(() => {
    if (payslipId === null) return;
    const current = ++requestId.current;
    void loadResource(() => loadPayslipDetail(payslipId)).then((resource) => {
      if (current !== requestId.current) return;
      setDetail(resource);
      if (resource.status === 'error' && resource.kind === 'session-expired') {
        handleApiError(new ApiError('session_expired', 401));
      }
    });
    return () => {
      requestId.current += 1;
    };
  }, [attempt, handleApiError, payslipId]);

  const retry = useCallback(() => {
    setDetail({ status: 'loading' });
    setAttempt((current) => current + 1);
  }, []);

  const amount = (value: number | null) => formatCurrencyValue(localization, value);

  return (
    <DetailSheet
      onClose={onClose}
      subtitle={periodLabel(payslip, localization)}
      testID="payslip-detail"
      title={t('payslips.detail')}
      visible
    >
      {detail.status === 'loading' ? <SkeletonCard testID="payslip-detail-skeleton" /> : null}
      {detail.status === 'error' ? (
        <ResourceFailure compact kind={detail.kind} onRetry={retry} />
      ) : null}
      {detail.status === 'ready' ? (
        <>
          <Card elevated>
            <AppText style={directionHelpers.text} tone="muted" variant="footnote">
              {t('payslips.netSalary')}
            </AppText>
            <AppText style={directionHelpers.text} variant="title1">
              {amount(detail.data.netSalary)}
            </AppText>
          </Card>

          <View style={styles.rows}>
            <DetailRow label={t('payslips.basicSalary')} value={amount(detail.data.basicSalary)} />
            <DetailRow
              label={t('payslips.transportation')}
              value={amount(detail.data.transportationAllowance)}
            />
            <DetailRow
              label={t('payslips.accommodation')}
              value={amount(detail.data.accommodationAllowance)}
            />
            <DetailRow
              label={t('payslips.telephone')}
              value={amount(detail.data.telephoneAllowance)}
            />
            <DetailRow label={t('payslips.petrol')} value={amount(detail.data.petrolAllowance)} />
            <DetailRow label={t('payslips.other')} value={amount(detail.data.otherAllowance)} />
            <DetailRow label={t('payslips.totalSalary')} value={amount(detail.data.totalSalary)} />
            <DetailRow
              label={t('payslips.totalDeductions')}
              value={amount(detail.data.totalDeductions)}
            />
            <DetailRow
              label={t('payslips.paymentMode')}
              value={detail.data.paymentMode ?? t('common.notAvailable')}
            />
          </View>

          <View style={styles.notice} testID="payslip-download-notice">
            <AppText style={directionHelpers.text} tone="warning" variant="footnote">
              {t('payslips.downloadUnavailable')}
            </AppText>
          </View>
        </>
      ) : null}
    </DetailSheet>
  );
}

/** Mounted only while open, so payslip amounts are discarded when the sheet closes. */
export function PayslipsSheet({ onClose }: PayslipsSheetProps) {
  const localization = useLocalization();
  const { t } = localization;
  const [selected, setSelected] = useState<PayslipSummary | null>(null);
  const { resource, retry } = useResource<PayslipSummary[]>(useCallback(() => loadPayslips(), []));

  return (
    <>
      <DetailSheet
        onClose={onClose}
        testID="payslips-sheet"
        title={t('payslips.title')}
        visible={selected === null}
      >
        {resource.status === 'loading' ? (
          <SkeletonList rows={4} testID="payslips-skeleton" />
        ) : null}
        {resource.status === 'error' ? (
          <ResourceFailure kind={resource.kind} onRetry={() => void retry()} />
        ) : null}
        {resource.status === 'ready' && resource.data.length === 0 ? (
          <EmptyState emoji="🧾" message={t('payslips.noPayslips')} title={t('payslips.title')} />
        ) : null}
        {resource.status === 'ready' && resource.data.length > 0 ? (
          <Card>
            <View accessibilityRole="list" style={styles.list}>
              {resource.data.map((payslip, index) => {
                const status = payslipStatusPresentation(payslip.status);
                return (
                  <View
                    key={String(payslip.id ?? `${payslip.year}-${payslip.month}-${index}`)}
                    style={index > 0 ? styles.separated : undefined}
                  >
                    <ListRow
                      accessibilityHint={t('accessibility.opensDetailHint')}
                      onPress={() => setSelected(payslip)}
                      subtitle={`${t('payslips.netSalary')}: ${formatCurrencyValue(localization, payslip.netSalary)}`}
                      testID={`payslip-${payslip.id ?? index}`}
                      title={periodLabel(payslip, localization)}
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
        ) : null}
      </DetailSheet>

      {selected ? (
        <PayslipDetailSheet onClose={() => setSelected(null)} payslip={selected} />
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
