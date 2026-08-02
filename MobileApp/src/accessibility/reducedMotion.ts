import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

export function motionDuration(preferredDuration: number, reduceMotionEnabled: boolean): number {
  return reduceMotionEnabled ? 0 : Math.max(0, preferredDuration);
}

export function useReducedMotion(): boolean {
  const [reduceMotionEnabled, setReduceMotionEnabled] = useState(false);

  useEffect(() => {
    let mounted = true;

    void AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (mounted) setReduceMotionEnabled(enabled);
      })
      .catch(() => undefined);

    const subscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      setReduceMotionEnabled,
    );

    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  return reduceMotionEnabled;
}
