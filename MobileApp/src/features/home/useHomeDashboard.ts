import { useCallback, useEffect, useRef, useState } from 'react';

import { loadHomeDashboard } from './home-api';
import type { HomeDashboardSnapshot } from './types';

interface HomeDashboardState {
  snapshot: HomeDashboardSnapshot | null;
  isLoading: boolean;
  isRefreshing: boolean;
}

export function useHomeDashboard() {
  const mounted = useRef(true);
  const requestSequence = useRef(0);
  const [state, setState] = useState<HomeDashboardState>({
    snapshot: null,
    isLoading: true,
    isRefreshing: false,
  });

  const reload = useCallback(async (refreshing = false) => {
    const sequence = ++requestSequence.current;
    setState((current) => ({
      ...current,
      isLoading: refreshing ? current.isLoading : current.snapshot === null,
      isRefreshing: refreshing,
    }));
    const snapshot = await loadHomeDashboard();
    if (!mounted.current || sequence !== requestSequence.current) return;
    setState({ snapshot, isLoading: false, isRefreshing: false });
  }, []);

  useEffect(() => {
    mounted.current = true;
    const sequence = ++requestSequence.current;
    void loadHomeDashboard().then((snapshot) => {
      if (!mounted.current || sequence !== requestSequence.current) return;
      setState({ snapshot, isLoading: false, isRefreshing: false });
    });
    return () => {
      mounted.current = false;
      requestSequence.current += 1;
    };
  }, []);

  return {
    ...state,
    refresh: () => reload(true),
    retry: () => reload(false),
  };
}
