import { describe, expect, it } from "vitest";

import { translations } from "./translations";

/**
 * The manager area is shipped in both languages, so an English-only key would
 * surface a raw key string to Arabic users. These tests fail on that.
 */

const en = translations.en;
const ar = translations.ar;

/** Prefixes owned by the manager area and the surfaces it shares. */
const MANAGER_PREFIXES = ["manager.", "requestAge.", "loans.details.", "loans.inbox."];

function managerKeys(dictionary: Record<string, string>) {
    return Object.keys(dictionary).filter((key) =>
        MANAGER_PREFIXES.some((prefix) => key.startsWith(prefix)),
    );
}

describe("manager area translations", () => {
    it("has an Arabic string for every manager key", () => {
        const missing = managerKeys(en).filter((key) => !ar[key]);
        expect(missing).toEqual([]);
    });

    it("has an English string for every Arabic manager key", () => {
        const missing = managerKeys(ar).filter((key) => !en[key]);
        expect(missing).toEqual([]);
    });

    it("keeps the {count} token in both languages so numbers are interpolated", () => {
        const tokenKeys = managerKeys(en).filter((key) => en[key].includes("{count}"));
        expect(tokenKeys.length).toBeGreaterThan(0);
        tokenKeys.forEach((key) => {
            expect(ar[key], `${key} lost its {count} token in Arabic`).toContain("{count}");
        });
    });

    it("covers the labels the rebuilt manager screens ask for", () => {
        const required = [
            "manager.dashboard.title",
            "manager.dashboard.overviewContext",
            "manager.dashboard.pendingApprovals",
            "manager.dashboard.priorityQueue",
            "manager.dashboard.teamSnapshot",
            "manager.dashboard.reviewPending",
            "manager.dashboard.queue.leave",
            "manager.dashboard.queue.loan",
            "manager.dashboard.queue.attendance",
            "manager.dashboard.queue.assetReturn",
            "manager.dashboard.directReports",
            "manager.queue.type.leave",
            "manager.queue.type.loan",
            "manager.queue.type.attendance",
            "manager.queue.type.assetReturn",
            "manager.requests.awaitingCount",
            "manager.requests.rejectTitle",
            "manager.requests.rejectConfirm",
            "manager.requests.searchPlaceholder",
            "manager.requests.waiting",
            "manager.team.searchPlaceholder",
            "manager.team.departmentFilter",
            "manager.team.viewProfile",
            "manager.team.noMatches",
            "manager.team.profile.readOnlyNote",
            "manager.team.profile.openRequests",
            "manager.leaveDetails.decisionClosed",
            "manager.leaveDetails.approvalTrail",
            "manager.empty.noAssetReturnsTitle",
            "requestAge.today",
            "requestAge.oneDay",
            "requestAge.days",
            "loans.details.decisionClosed",
            "loans.details.approvalTrail",
            "loans.inbox.emptyTitle",
            "common.clearFilters",
        ];

        required.forEach((key) => {
            expect(en[key], `missing English string for ${key}`).toBeTruthy();
            expect(ar[key], `missing Arabic string for ${key}`).toBeTruthy();
        });
    });

    it("does not describe the manager area as a role in the navigation", () => {
        expect(en["layout.menu.manager"]).toBeUndefined();
        expect(en["layout.managerDashboard"]).toBeUndefined();
        expect(en["layout.menu.teamOperations"]).toBe("Team Operations");
        expect(en["layout.teamDashboard"]).toBe("Team Dashboard");
    });
});
