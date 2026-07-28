import { useCallback, useEffect, useRef, useState } from 'react';

import { useAuth } from '@/providers/AuthProvider';
import { ApiError } from '@/services/api';

import { isSessionExpired, loadResource, type Resource } from './resource';

interface ResourceState<T> {
  resource: Resource<T>;
  isRefreshing: boolean;
}

export interface UseResourceResult<T> {
  resource: Resource<T>;
  isRefreshing: boolean;
  refresh: () => Promise<void>;
  retry: () => Promise<void>;
  /** Replaces in-memory data after a successful mutation without a second round trip. */
  replace: (updater: (current: T) => T) => void;
}

/**
 * Single-flight, unmount-safe loader for one screen section. Server data lives only in
 * component state — this hook owns no cache and writes nothing to storage.
 *
 * `load` must be a stable callback (wrap it in `useCallback`); it is the effect's only
 * data dependency, so an unstable reference would refetch on every render.
 */
export function useResource<T>(load: () => Promise<T>): UseResourceResult<T> {
  const { handleApiError } = useAuth();
  const mounted = useRef(true);
  const sequence = useRef(0);

  const [state, setState] = useState<ResourceState<T>>({
    resource: { status: 'loading' },
    isRefreshing: false,
  });

  const settle = useCallback(
    (resource: Resource<T>) => {
      setState({ resource, isRefreshing: false });
      if (isSessionExpired(resource)) handleApiError(new ApiError('session_expired', 401));
    },
    [handleApiError],
  );

  /** Only ever called from an event handler or a resolved promise, never during render. */
  const run = useCallback(
    async (refreshing: boolean) => {
      const current = ++sequence.current;
      setState((previous) => ({
        resource: refreshing ? previous.resource : { status: 'loading' },
        isRefreshing: refreshing,
      }));
      const resource = await loadResource(load);
      if (!mounted.current || current !== sequence.current) return;
      settle(resource);
    },
    [load, settle],
  );

  useEffect(() => {
    mounted.current = true;
    const current = ++sequence.current;
    void loadResource(load).then((resource) => {
      if (!mounted.current || current !== sequence.current) return;
      settle(resource);
    });
    return () => {
      mounted.current = false;
      sequence.current += 1;
    };
  }, [load, settle]);

  const replace = useCallback((updater: (current: T) => T) => {
    setState((previous) =>
      previous.resource.status === 'ready'
        ? { ...previous, resource: { status: 'ready', data: updater(previous.resource.data) } }
        : previous,
    );
  }, []);

  return {
    resource: state.resource,
    isRefreshing: state.isRefreshing,
    refresh: () => run(true),
    retry: () => run(false),
    replace,
  };
}
