import { Tabs } from 'expo-router';
import type { ComponentProps } from 'react';

import { hasAnyApprovalAccess, isEmployeeSelfServiceRole, normalizeRole } from '@/auth/role';
import { AppIcon } from '@/components/ui';
import { colors, layout } from '@/design-system';
import { useLocalization } from '@/i18n';
import type { TranslationKey } from '@/i18n';
import { useAuth } from '@/providers';

interface TabDefinition {
  icon: ComponentProps<typeof AppIcon>['name'];
  labelKey: TranslationKey;
  name: string;
}

const SELF_SERVICE_TABS: TabDefinition[] = [
  { icon: 'house.fill', labelKey: 'tabs.home', name: 'home' },
  { icon: 'clock.fill', labelKey: 'tabs.attendance', name: 'attendance' },
  { icon: 'calendar', labelKey: 'tabs.leave', name: 'leave' },
];

const APPROVALS_TAB: TabDefinition = {
  icon: 'checkmark.seal.fill',
  labelKey: 'tabs.approvals',
  name: 'approvals',
};

const SHARED_TABS: TabDefinition[] = [
  { icon: 'bell.fill', labelKey: 'tabs.notifications', name: 'notifications' },
  { icon: 'ellipsis.circle.fill', labelKey: 'tabs.more', name: 'more' },
];

/**
 * HR keeps every employee tab and gains Approvals; CEO/CFO/SystemAdmin are not
 * employees in this app's sense and get the approver-only shell.
 */
export function tabsForRole(rawRole: string | undefined | null): TabDefinition[] {
  const role = normalizeRole(rawRole);
  return [
    ...(isEmployeeSelfServiceRole(role) ? SELF_SERVICE_TABS : []),
    ...(hasAnyApprovalAccess(role) ? [APPROVALS_TAB] : []),
    ...SHARED_TABS,
  ];
}

const ALL_TABS: TabDefinition[] = [...SELF_SERVICE_TABS, APPROVALS_TAB, ...SHARED_TABS];

export default function TabLayout() {
  const { isRTL, t } = useLocalization();
  const { user } = useAuth();

  const tabs = tabsForRole(user?.role);

  // expo-router's bottom tab bar always lays its items out in registration
  // order using a fixed `flexDirection: 'row'` (it does not read tabBarStyle
  // for this, and this app intentionally never calls I18nManager.forceRTL,
  // since that requires an app restart and would break the "language applies
  // immediately" behaviour). So under Arabic we mirror the tab order
  // ourselves by reversing which screens are registered first.
  const orderedTabs = isRTL ? [...tabs].reverse() : tabs;

  // Expo Router auto-discovers every file under `(tabs)/`, so a screen this
  // role may not use has to be registered explicitly with `href: null` to stay
  // out of the tab bar. The screens themselves also guard by role.
  const hiddenTabs = ALL_TABS.filter((tab) => !tabs.some((visible) => visible.name === tab.name));

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: colors.cream },
        tabBarActiveTintColor: colors.text,
        tabBarInactiveTintColor: colors.muted,
        tabBarLabelStyle: { fontSize: 12 },
        tabBarStyle: {
          backgroundColor: colors.cream,
          borderTopColor: colors.border,
          minHeight: layout.preferredTouchTarget + 20,
        },
      }}
    >
      {orderedTabs.map(({ icon, labelKey, name }) => (
        <Tabs.Screen
          key={name}
          name={name}
          options={{
            tabBarAccessibilityLabel: t(labelKey),
            tabBarIcon: ({ focused }) => (
              <AppIcon
                name={icon}
                size={22}
                tone={focused ? 'default' : 'muted'}
                treatment={focused ? 'soft' : 'plain'}
              />
            ),
            title: t(labelKey),
          }}
        />
      ))}
      {hiddenTabs.map(({ name }) => (
        <Tabs.Screen key={name} name={name} options={{ href: null }} />
      ))}
    </Tabs>
  );
}
