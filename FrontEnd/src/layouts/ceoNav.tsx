import {
  AppstoreOutlined,
  BellOutlined,
  CalendarOutlined,
  ClockCircleOutlined,
  DashboardOutlined,
  DollarOutlined,
  FileSearchOutlined,
  IdcardOutlined,
  InboxOutlined,
  SolutionOutlined,
  TeamOutlined,
} from "@ant-design/icons";
import type { MenuProps } from "antd";
import { Link } from "react-router-dom";

import { sectionLabel } from "./menuUtils";

type TranslateFn = (key: string, params?: Record<string, unknown> | string, fallback?: string) => string;

/** Collapsible groups in the CEO sidebar, keyed by the paths that open them. */
export const CEO_SUBMENUS: Array<{ key: string; matches: string[] }> = [
  { key: "ceo-assets-sub", matches: ["/ceo/assets"] },
  { key: "ceo-announcements-sub", matches: ["/ceo/announcements"] },
];

export function getCeoOpenKeysForPath(pathname: string): string[] {
  return CEO_SUBMENUS.filter((submenu) => submenu.matches.some((prefix) => pathname.startsWith(prefix))).map(
    (submenu) => submenu.key,
  );
}

/**
 * CEO sidebar, grouped by what the CEO is doing rather than by which backend
 * owns the route: Overview, Approvals, Operations, Team & Communication,
 * Profile.
 *
 * Every entry appears once. Where a manager-level route renders the same page
 * as a CEO route (`/manager/team`, `/manager/team-requests`) only the CEO route
 * is listed; the manager routes that show genuinely different data keep their
 * own entry under a distinct label.
 */
export function buildCeoMenuItems(t: TranslateFn): MenuProps["items"] {
  return [
    {
      type: "group",
      label: sectionLabel(t("layout.menu.overview", "Overview"), t("ceo.nav.overviewCaption")),
      children: [
        {
          key: "/ceo/dashboard",
          icon: <DashboardOutlined />,
          label: <Link to="/ceo/dashboard">{t("layout.dashboard")}</Link>,
        },
        {
          key: "/pending-inbox",
          icon: <InboxOutlined />,
          label: <Link to="/pending-inbox">{t("layout.pendingInbox", "Pending Inbox")}</Link>,
        },
        {
          key: "/manager/dashboard",
          icon: <DashboardOutlined />,
          label: <Link to="/manager/dashboard">{t("layout.teamDashboard", "Team Dashboard")}</Link>,
        },
      ],
    },
    {
      type: "group",
      label: sectionLabel(t("layout.menu.approvals", "Approvals"), t("ceo.nav.approvalsCaption")),
      children: [
        {
          key: "/ceo/leave/requests",
          icon: <CalendarOutlined />,
          label: <Link to="/ceo/leave/requests">{t("layout.ceoLeaveApprovals", "Leave Approvals")}</Link>,
        },
        {
          key: "/ceo/loan-requests",
          icon: <DollarOutlined />,
          label: <Link to="/ceo/loan-requests">{t("layout.loanRequests", "Loan Requests")}</Link>,
        },
        {
          key: "/manager/loan-requests",
          icon: <DollarOutlined />,
          label: <Link to="/manager/loan-requests">{t("layout.teamLoanRequests", "Team Loan Requests")}</Link>,
        },
        {
          key: "/ceo/hiring-requests",
          icon: <SolutionOutlined />,
          label: (
            <Link to="/ceo/hiring-requests">
              {t("layout.hiringRequests", "Hiring Requests")}
            </Link>
          ),
        },
        {
          key: "/ceo/employees/deletion-requests",
          icon: <TeamOutlined />,
          label: (
            <Link to="/ceo/employees/deletion-requests">
              {t("employees.removalInbox.menu", "Employee Removals")}
            </Link>
          ),
        },
        {
          key: "ceo-assets-sub",
          icon: <AppstoreOutlined />,
          label: t("layout.assetReviews", "Asset Reviews"),
          children: [
            {
              key: "/ceo/assets/damage-reports",
              label: (
                <Link to="/ceo/assets/damage-reports">{t("assets.damageReports", "Damage Reports")}</Link>
              ),
            },
            {
              key: "/ceo/assets/return-requests",
              label: (
                <Link to="/ceo/assets/return-requests">{t("assets.returnRequests", "Return Requests")}</Link>
              ),
            },
          ],
        },
      ],
    },
    {
      type: "group",
      label: sectionLabel(t("layout.menu.operations", "Operations"), t("ceo.nav.operationsCaption")),
      children: [
        {
          key: "/ceo/attendance",
          icon: <ClockCircleOutlined />,
          label: <Link to="/ceo/attendance">{t("layout.attendance")}</Link>,
        },
      ],
    },
    {
      type: "group",
      label: sectionLabel(t("layout.menu.teamComms", "Team & Communication"), t("ceo.nav.teamCaption")),
      children: [
        {
          key: "/ceo/team",
          icon: <TeamOutlined />,
          label: <Link to="/ceo/team">{t("layout.ceoTeam", "Leadership Team")}</Link>,
        },
        {
          key: "/ceo/team-requests",
          icon: <FileSearchOutlined />,
          label: <Link to="/ceo/team-requests">{t("layout.teamRequests", "Team Requests")}</Link>,
        },
        {
          key: "ceo-announcements-sub",
          icon: <BellOutlined />,
          label: t("layout.announcements", "Announcements"),
          children: [
            {
              key: "/ceo/announcements",
              label: <Link to="/ceo/announcements">{t("layout.myFeed", "My Feed")}</Link>,
            },
            {
              key: "/ceo/announcements/create",
              label: <Link to="/ceo/announcements/create">{t("layout.newAnnouncement", "New")}</Link>,
            },
          ],
        },
      ],
    },
    {
      type: "group",
      label: sectionLabel(t("layout.profile"), t("ceo.nav.profileCaption")),
      children: [
        {
          key: "/ceo/profile",
          icon: <IdcardOutlined />,
          label: <Link to="/ceo/profile">{t("layout.profile")}</Link>,
        },
      ],
    },
  ];
}
