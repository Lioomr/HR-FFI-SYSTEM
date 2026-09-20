import { Link } from "react-router-dom";
import {
  ClockCircleOutlined,
  DashboardOutlined,
  FileSearchOutlined,
  InboxOutlined,
  TeamOutlined,
} from "@ant-design/icons";
import type { MenuProps } from "antd";

import { sectionLabel } from "./menuUtils";

type Translate = (
  key: string,
  params?: Record<string, any> | string,
  fallback?: string,
) => string;

type MenuItemGroup = NonNullable<MenuProps["items"]>[number];

/**
 * "My Team" navigation group.
 *
 * Rendered for anyone the backend grants manager capability to, regardless of
 * role, so it is built once here and reused by every role menu.
 */
export function buildManagerNavGroup(t: Translate): MenuItemGroup {
  return {
    type: "group" as const,
    label: sectionLabel(t("layout.menu.myTeam", "My Team")),
    children: [
      {
        key: "/manager/dashboard",
        icon: <DashboardOutlined />,
        label: (
          <Link to="/manager/dashboard">
            {t("layout.teamDashboard", "Team Dashboard")}
          </Link>
        ),
      },
      // Everything currently waiting on this user, across request types.
      {
        key: "/pending-inbox",
        icon: <InboxOutlined />,
        label: (
          <Link to="/pending-inbox">
            {t("layout.pendingInbox", "Pending Inbox")}
          </Link>
        ),
      },
      {
        key: "/manager/team",
        icon: <TeamOutlined />,
        label: <Link to="/manager/team">{t("layout.myTeam", "My Team")}</Link>,
      },
      // Leave, loan, permission and asset-return queues are tabs of this page.
      {
        key: "/manager/team-requests",
        icon: <FileSearchOutlined />,
        label: (
          <Link to="/manager/team-requests">
            {t("layout.teamRequests", "Team Requests")}
          </Link>
        ),
      },
      {
        key: "/manager/attendance",
        icon: <ClockCircleOutlined />,
        label: (
          <Link to="/manager/attendance">{t("attendance.managerTitle")}</Link>
        ),
      },
    ],
  };
}

/** Manager nav entries, or nothing when the user has no manager capability. */
export function buildManagerNavGroups(
  t: Translate,
  hasManagerAccess: boolean,
): MenuItemGroup[] {
  return hasManagerAccess ? [buildManagerNavGroup(t)] : [];
}
