import { describe, it, expect } from "vitest";
import {
  groupNotificationsByDay,
  notificationDayGroup,
} from "./notificationMeta";

// Local-time "now": 12 Sep 2026, 10:00.
const now = new Date(2026, 8, 12, 10, 0, 0);
const at = (day: number, hour = 9) =>
  new Date(2026, 8, day, hour, 0, 0).toISOString();

describe("notificationDayGroup", () => {
  it("buckets by local calendar day", () => {
    expect(notificationDayGroup(at(12, 0), now)).toBe("today");
    expect(notificationDayGroup(at(11, 23), now)).toBe("yesterday");
    expect(notificationDayGroup(at(6), now)).toBe("lastWeek");
    expect(notificationDayGroup(at(5, 23), now)).toBe("older");
  });

  it("treats invalid dates as older", () => {
    expect(notificationDayGroup("not-a-date", now)).toBe("older");
  });
});

describe("groupNotificationsByDay", () => {
  it("keeps server order and splits into consecutive sections", () => {
    const items = [
      { id: 1, created_at: at(12) },
      { id: 2, created_at: at(12, 1) },
      { id: 3, created_at: at(11) },
      { id: 4, created_at: at(1) },
    ];
    const groups = groupNotificationsByDay(items, now);
    expect(groups.map((g) => g.key)).toEqual(["today", "yesterday", "older"]);
    expect(groups[0].items.map((i) => i.id)).toEqual([1, 2]);
  });

  it("returns no sections for an empty list", () => {
    expect(groupNotificationsByDay([], now)).toEqual([]);
  });
});
