import { useEffect } from "react";
import { useAuthStore } from "../auth/authStore";
import { getSettings } from "../services/api/settingsApi";
import { isApiError } from "../services/api/apiTypes";

const FALLBACK_IDLE_TIMEOUT_MS = 15 * 60 * 1000;

export function useIdleTimeout() {
  useEffect(() => {
    let timeoutId: number;
    let idleTimeoutMs = FALLBACK_IDLE_TIMEOUT_MS;
    let disposed = false;

    const resetTimer = () => {
      window.clearTimeout(timeoutId);
      timeoutId = window.setTimeout(() => {
        // Auto-clean on idle timeout
        useAuthStore.getState().logout();
      }, idleTimeoutMs);
    };

    // Listeners for user activity
    const events = [
      "mousemove",
      "keydown",
      "wheel",
      "touchstart",
      "click",
      "scroll",
    ];

    events.forEach((event) => {
      window.addEventListener(event, resetTimer);
    });

    // Initialize
    resetTimer();

    void getSettings()
      .then((response) => {
        if (disposed || isApiError(response)) return;

        const timeoutMinutes = response.data.session?.timeout_minutes;
        if (typeof timeoutMinutes !== "number" || timeoutMinutes <= 0) return;

        idleTimeoutMs = timeoutMinutes * 60 * 1000;
        resetTimer();
      })
      .catch(() => {
        // Keep the safe fallback when settings are unavailable.
      });

    return () => {
      disposed = true;
      window.clearTimeout(timeoutId);
      events.forEach((event) => {
        window.removeEventListener(event, resetTimer);
      });
    };
  }, []);
}
