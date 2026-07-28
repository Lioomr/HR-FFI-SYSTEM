import { ApiError } from '@/services/api';

/**
 * The failure vocabulary every Gate 3 screen renders. It is derived only from the
 * redacted `ApiError` contract, so no server text or transport detail leaks into UI.
 */
export type ResourceFailureKind =
  'offline' | 'forbidden' | 'not-found' | 'session-expired' | 'unavailable';

export type Resource<T> =
  | { status: 'loading' }
  | { status: 'ready'; data: T }
  | { status: 'error'; kind: ResourceFailureKind };

export function failureKind(reason: unknown): ResourceFailureKind {
  if (reason instanceof ApiError) {
    if (reason.code === 'network_unavailable') return 'offline';
    if (reason.code === 'session_expired') return 'session-expired';
    if (reason.code === 'forbidden') return 'forbidden';
    if (reason.code === 'not_found') return 'not-found';
  }
  return 'unavailable';
}

export function isSessionExpired(resource: Resource<unknown>): boolean {
  return resource.status === 'error' && resource.kind === 'session-expired';
}

/** Wraps a settled request so one failing section never discards a sibling's data. */
export function resourceFrom<T>(
  result: PromiseSettledResult<unknown>,
  parse: (value: unknown) => T,
): Resource<T> {
  if (result.status === 'rejected') return { status: 'error', kind: failureKind(result.reason) };
  try {
    return { status: 'ready', data: parse(result.value) };
  } catch (error) {
    return { status: 'error', kind: failureKind(error) };
  }
}

export async function loadResource<T>(load: () => Promise<T>): Promise<Resource<T>> {
  try {
    return { status: 'ready', data: await load() };
  } catch (error) {
    return { status: 'error', kind: failureKind(error) };
  }
}
