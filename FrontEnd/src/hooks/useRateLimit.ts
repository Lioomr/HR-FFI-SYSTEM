import { useRef, useCallback } from "react";
import { message } from "antd";
import { useI18n } from "../i18n/useI18n";

/**
 * Custom hook to prevent rapid successive function calls (UI rate limiting).
 * Useful for buttons that trigger API calls to prevent spam clicking.
 *
 * @param callback The function to execute
 * @param delayMs The cooldown period in milliseconds
 * @param showWarning If true, displays a toast message when rate-limited
 * @returns A wrapped version of the callback that enforces the rate limit
 */
export function useRateLimit<T extends (...args: any[]) => any>(
  callback: T,
  delayMs: number = 2000,
  showWarning: boolean = true,
): (...args: Parameters<T>) => void {
  const lastCalledRef = useRef<number>(0);
  const { t } = useI18n();

  return useCallback(
    (...args: Parameters<T>) => {
      const now = Date.now();
      const timeSinceLastCall = now - lastCalledRef.current;

      if (timeSinceLastCall < delayMs) {
        if (showWarning) {
          message.warning(t("common.rateLimited"));
        }
        return;
      }

      lastCalledRef.current = now;
      return callback(...args);
    },
    [callback, delayMs, showWarning, t],
  );
}
