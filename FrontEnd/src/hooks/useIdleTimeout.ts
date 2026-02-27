import { useEffect } from "react";
import { useAuthStore } from "../auth/authStore";

const IDLE_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes

export function useIdleTimeout() {
    useEffect(() => {
        let timeoutId: number;

        const resetTimer = () => {
            window.clearTimeout(timeoutId);
            timeoutId = window.setTimeout(() => {
                // Auto-clean on idle timeout
                useAuthStore.getState().logout();
            }, IDLE_TIMEOUT_MS);
        };

        // Listeners for user activity
        const events = ["mousemove", "keydown", "wheel", "touchstart", "click", "scroll"];

        events.forEach((event) => {
            window.addEventListener(event, resetTimer);
        });

        // Initialize
        resetTimer();

        return () => {
            window.clearTimeout(timeoutId);
            events.forEach((event) => {
                window.removeEventListener(event, resetTimer);
            });
        };
    }, []);
}
