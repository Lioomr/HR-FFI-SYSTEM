import { useCallback, useState } from 'react';
import { Keyboard, Pressable, StyleSheet, View } from 'react-native';

import {
  AppText,
  Button,
  Card,
  DetailSheet,
  EmptyState,
  Field,
  ListRow,
  SkeletonList,
} from '@/components/ui';
import { colors, layout, radii, spacing } from '@/design-system';
import { useLocalization } from '@/i18n';
import type { TranslationKey } from '@/i18n';
import { useAuth } from '@/providers';

import { DateField } from '../leave/DateField';
import { formatDateTimeValue, ResourceFailure, useResource } from '../shared';

import {
  createDelegationRule,
  loadDelegationCandidates,
  loadDelegationRules,
  setDelegationRuleActive,
  validateDelegationDraft,
} from './delegations-api';
import type { DelegationCandidate, DelegationDraft, DelegationRule } from './types';

const EMPTY_DRAFT: DelegationDraft = { toUserId: null, startDate: '', endDate: '', reason: '' };

export function DelegationRulesSheet({ onClose }: { onClose: () => void }) {
  const { handleApiError, user } = useAuth();
  const localization = useLocalization();
  const { directionHelpers, t } = localization;
  const currentUserId = user?.id;
  const [draft, setDraft] = useState<DelegationDraft>(EMPTY_DRAFT);
  const [errors, setErrors] = useState<Partial<Record<keyof DelegationDraft, TranslationKey>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [updatingId, setUpdatingId] = useState<number | string | null>(null);
  const { resource, refresh, retry } = useResource(
    useCallback(async () => {
      const [rules, candidates] = await Promise.all([
        loadDelegationRules(),
        loadDelegationCandidates(),
      ]);
      return { candidates, rules };
    }, []),
  );

  const close = useCallback(() => {
    setDraft(EMPTY_DRAFT);
    setErrors({});
    setFormError(null);
    onClose();
  }, [onClose]);

  const submit = useCallback(async () => {
    if (saving || !currentUserId) return;
    Keyboard.dismiss();
    const nextErrors = validateDelegationDraft(draft);
    setErrors(nextErrors);
    setFormError(null);
    if (Object.keys(nextErrors).length) return;

    setSaving(true);
    try {
      await createDelegationRule(currentUserId, draft);
      setDraft(EMPTY_DRAFT);
      await refresh();
    } catch (error) {
      if (!handleApiError(error)) setFormError(t('state.actionFailed'));
    } finally {
      setSaving(false);
    }
  }, [currentUserId, draft, handleApiError, refresh, saving, t]);

  const updateActive = useCallback(
    async (rule: DelegationRule) => {
      if (rule.id === null || updatingId !== null) return;
      setUpdatingId(rule.id);
      try {
        await setDelegationRuleActive(rule.id, !rule.isActive);
        await refresh();
      } catch (error) {
        if (!handleApiError(error)) setFormError(t('state.actionFailed'));
      } finally {
        setUpdatingId(null);
      }
    },
    [handleApiError, refresh, t, updatingId],
  );

  return (
    <DetailSheet
      onClose={close}
      subtitle={t('delegations.subtitle')}
      testID="delegations-sheet"
      title={t('delegations.title')}
      visible
    >
      {formError ? (
        <AppText accessibilityLiveRegion="assertive" style={directionHelpers.text} tone="error">
          {formError}
        </AppText>
      ) : null}
      <View style={styles.section}>
        <AppText accessibilityRole="header" style={directionHelpers.text} variant="headline">
          {t('delegations.newTitle')}
        </AppText>
        <AppText style={directionHelpers.text} tone="muted" variant="subhead">
          {t('delegations.newHint')}
        </AppText>
        {resource.status === 'ready' ? (
          <CandidatePicker
            candidates={resource.data.candidates}
            draft={draft}
            onChange={(toUserId) => setDraft((current) => ({ ...current, toUserId }))}
          />
        ) : null}
        <DateField
          error={errors.startDate ? t(errors.startDate) : undefined}
          label={t('delegations.startDate')}
          onChange={(startDate) =>
            setDraft((current) => ({
              ...current,
              startDate,
              endDate: current.endDate && current.endDate < startDate ? startDate : current.endDate,
            }))
          }
          testID="delegations-start-date"
          value={draft.startDate}
        />
        <DateField
          error={errors.endDate ? t(errors.endDate) : undefined}
          label={t('delegations.endDate')}
          minimumDate={draft.startDate ? new Date(`${draft.startDate}T00:00:00Z`) : undefined}
          onChange={(endDate) => setDraft((current) => ({ ...current, endDate }))}
          testID="delegations-end-date"
          value={draft.endDate}
        />
        <Field
          label={t('delegations.reason')}
          multiline
          numberOfLines={3}
          onChangeText={(reason) => setDraft((current) => ({ ...current, reason }))}
          placeholder={t('delegations.reasonPlaceholder')}
          testID="delegations-reason"
          value={draft.reason}
        />
        <Button
          disabled={resource.status !== 'ready' || !currentUserId}
          fullWidth
          label={t('delegations.create')}
          loading={saving}
          onPress={() => void submit()}
          testID="delegations-create"
        />
      </View>

      <View style={styles.section}>
        <AppText accessibilityRole="header" style={directionHelpers.text} variant="headline">
          {t('delegations.currentTitle')}
        </AppText>
        {resource.status === 'loading' ? <SkeletonList rows={2} /> : null}
        {resource.status === 'error' ? (
          <ResourceFailure kind={resource.kind} onRetry={() => void retry()} />
        ) : null}
        {resource.status === 'ready' && resource.data.rules.length === 0 ? (
          <EmptyState
            compact
            emoji="↔️"
            message={t('delegations.empty')}
            title={t('delegations.currentTitle')}
          />
        ) : null}
        {resource.status === 'ready' && resource.data.rules.length ? (
          <Card>
            <View style={styles.list}>
              {resource.data.rules.map((rule, index) => (
                <View key={String(rule.id ?? index)} style={index ? styles.separated : undefined}>
                  <ListRow
                    meta={rule.isActive ? t('delegations.active') : t('delegations.inactive')}
                    subtitle={t('delegations.period', {
                      start: formatDateTimeValue(localization, rule.startAt),
                      end: rule.endAt
                        ? formatDateTimeValue(localization, rule.endAt)
                        : t('delegations.noEndDate'),
                    })}
                    title={`${rule.fromUser.fullName ?? rule.fromUser.email ?? t('common.notAvailable')} → ${rule.toUser.fullName ?? rule.toUser.email ?? t('common.notAvailable')}`}
                    trailing={
                      <Button
                        disabled={updatingId !== null || rule.id === null}
                        label={
                          rule.isActive ? t('delegations.deactivate') : t('delegations.activate')
                        }
                        loading={updatingId === rule.id}
                        onPress={() => void updateActive(rule)}
                        size="compact"
                        variant="secondary"
                      />
                    }
                  />
                </View>
              ))}
            </View>
          </Card>
        ) : null}
      </View>
    </DetailSheet>
  );
}

function CandidatePicker({
  candidates,
  draft,
  onChange,
}: {
  candidates: DelegationCandidate[];
  draft: DelegationDraft;
  onChange: (id: number | string) => void;
}) {
  const { directionHelpers, language, t } = useLocalization();
  const options = candidates.filter((candidate) => candidate.canDelegate && candidate.id !== null);

  return (
    <View style={styles.section}>
      <AppText style={directionHelpers.text} variant="subhead">
        {t('delegations.delegate')}
      </AppText>
      {options.length ? (
        <View accessibilityRole="radiogroup" style={styles.options}>
          {options.map((candidate) => {
            const label =
              language === 'ar'
                ? (candidate.fullNameAr ?? candidate.fullName ?? candidate.fullNameEn)
                : (candidate.fullNameEn ?? candidate.fullName ?? candidate.fullNameAr);
            const selected = String(candidate.id) === String(draft.toUserId);
            return (
              <Pressable
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                key={String(candidate.id)}
                onPress={() => onChange(candidate.id!)}
                style={[styles.option, selected && styles.optionSelected]}
                testID={`delegation-candidate-${candidate.id}`}
              >
                <AppText style={directionHelpers.text}>{selected ? `✓  ${label}` : label}</AppText>
                {candidate.employeeId ? (
                  <AppText style={directionHelpers.text} tone="muted" variant="footnote">
                    {candidate.employeeId}
                  </AppText>
                ) : null}
              </Pressable>
            );
          })}
        </View>
      ) : (
        <EmptyState
          compact
          emoji="🗂️"
          message={t('delegations.noCandidates')}
          title={t('delegations.delegate')}
        />
      )}
      {draft.toUserId === null ? (
        <AppText accessibilityLiveRegion="polite" tone="error" variant="footnote">
          {t('delegations.delegateRequired')}
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: spacing.md },
  list: { gap: spacing.xs },
  separated: { borderTopColor: colors.border, borderTopWidth: StyleSheet.hairlineWidth },
  options: { gap: spacing.sm },
  option: {
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    gap: spacing.xxs,
    minHeight: layout.minTouchTarget,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  optionSelected: { backgroundColor: colors.primarySoft, borderColor: colors.text, borderWidth: 2 },
});
