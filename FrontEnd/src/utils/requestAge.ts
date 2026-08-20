type Translate = (key: string, params?: Record<string, any> | string, fallback?: string) => string;

const DAY_MS = 86_400_000;

/** Whole days a request has been waiting, or null when the timestamp is unusable. */
export function requestAgeInDays(submittedAt?: string | null, now: number = Date.now()): number | null {
    if (!submittedAt) return null;
    const started = new Date(submittedAt).getTime();
    if (Number.isNaN(started)) return null;
    // A clock skew that puts the request in the future still reads as "today".
    return Math.max(0, Math.floor((now - started) / DAY_MS));
}

/**
 * How long a request has been waiting, in words.
 *
 * The translator does plain token replacement, so the zero and one forms are
 * separate keys rather than a plural rule.
 */
export function requestAgeLabel(t: Translate, submittedAt?: string | null, now?: number): string {
    const days = requestAgeInDays(submittedAt, now);
    if (days === null) return t("requestAge.unknown");
    if (days === 0) return t("requestAge.today");
    if (days === 1) return t("requestAge.oneDay");
    return t("requestAge.days", { count: days });
}

/** Waiting long enough to deserve visual emphasis in a queue. */
export const STALE_REQUEST_DAYS = 3;

export function isStaleRequest(submittedAt?: string | null, now?: number): boolean {
    const days = requestAgeInDays(submittedAt, now);
    return days !== null && days >= STALE_REQUEST_DAYS;
}
