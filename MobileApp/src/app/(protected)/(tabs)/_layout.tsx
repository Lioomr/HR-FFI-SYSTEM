import { Tabs } from 'expo-router';

import { AppIcon } from '@/components/ui';
import { colors, layout } from '@/design-system';
import { useLocalization } from '@/i18n';

export default function TabLayout() {
  const { t } = useLocalization();

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
      <Tabs.Screen
        name="home"
        options={{
          tabBarAccessibilityLabel: t('tabs.home'),
          tabBarIcon: ({ focused }) => (
            <AppIcon
              name="house.fill"
              size={22}
              tone={focused ? 'default' : 'muted'}
              treatment={focused ? 'soft' : 'plain'}
            />
          ),
          title: t('tabs.home'),
        }}
      />
      <Tabs.Screen
        name="attendance"
        options={{
          tabBarAccessibilityLabel: t('tabs.attendance'),
          tabBarIcon: ({ focused }) => (
            <AppIcon
              name="clock.fill"
              size={22}
              tone={focused ? 'default' : 'muted'}
              treatment={focused ? 'soft' : 'plain'}
            />
          ),
          title: t('tabs.attendance'),
        }}
      />
      <Tabs.Screen
        name="leave"
        options={{
          tabBarAccessibilityLabel: t('tabs.leave'),
          tabBarIcon: ({ focused }) => (
            <AppIcon
              name="calendar"
              size={22}
              tone={focused ? 'default' : 'muted'}
              treatment={focused ? 'soft' : 'plain'}
            />
          ),
          title: t('tabs.leave'),
        }}
      />
      <Tabs.Screen
        name="notifications"
        options={{
          tabBarAccessibilityLabel: t('tabs.notifications'),
          tabBarIcon: ({ focused }) => (
            <AppIcon
              name="bell.fill"
              size={22}
              tone={focused ? 'default' : 'muted'}
              treatment={focused ? 'soft' : 'plain'}
            />
          ),
          title: t('tabs.notifications'),
        }}
      />
      <Tabs.Screen
        name="more"
        options={{
          tabBarAccessibilityLabel: t('tabs.more'),
          tabBarIcon: ({ focused }) => (
            <AppIcon
              name="ellipsis.circle.fill"
              size={22}
              tone={focused ? 'default' : 'muted'}
              treatment={focused ? 'soft' : 'plain'}
            />
          ),
          title: t('tabs.more'),
        }}
      />
    </Tabs>
  );
}
