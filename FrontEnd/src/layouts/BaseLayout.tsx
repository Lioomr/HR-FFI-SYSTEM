import { useEffect, useMemo, useState } from "react";
import { Layout, Menu, Dropdown, Typography, Avatar, Drawer, Grid, Button, Select, Badge, Tooltip } from "antd";
import {
  DashboardOutlined,
  TeamOutlined,
  UserAddOutlined,
  FileSearchOutlined,
  SettingOutlined,
  LogoutOutlined,
  KeyOutlined,
  CalendarOutlined,
  ApartmentOutlined,
  IdcardOutlined,
  GroupOutlined,
  SafetyOutlined,
  UploadOutlined,
  DollarOutlined,
  DownOutlined,
  MenuOutlined,
  ClockCircleOutlined,
  BellOutlined,
  UserOutlined,
  AppstoreOutlined,
  UserSwitchOutlined,
  LockOutlined,
  FileTextOutlined,
  HomeOutlined,
  InboxOutlined,
} from "@ant-design/icons";
import type { MenuProps } from "antd";
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuthStore } from "../auth/authStore";
import { logoutApi } from "../services/api/authApi";
import { useI18n } from "../i18n/useI18n";
import type { AppLanguage } from "../i18n/types";
import { getEmployee } from "../services/api/employeesApi";
import { isApiError } from "../services/api/apiTypes";
import { getManagerAccess } from "../services/api/managerApi";
import { isFinanceApproverEmployee } from "../utils/financeApprover";
import { isCFOApproverEmployee } from "../utils/cfoApprover";
import { isCEOApproverEmployee } from "../utils/ceoApprover";
import { isHeadOfficeOrganization } from "../utils/organizationContext";

const { Header, Sider, Content } = Layout;
const { useBreakpoint } = Grid;

// ─── Brand Logo ────────────────────────────────────────────────────────────────
type BrandLogoProps = {
  collapsed?: boolean;
  title: string;
  subtitle: string;
  accent: string;
  accentGlow: string;
  titleColor?: string;
};

function BrandLogo({ collapsed, title, subtitle, accent, accentGlow, titleColor = "white" }: BrandLogoProps) {
  return (
    <div
      style={{
        padding: collapsed ? "16px 0" : "18px 16px",
        display: "flex",
        alignItems: "center",
        justifyContent: collapsed ? "center" : "flex-start",
        gap: 11,
        transition: "padding 0.25s cubic-bezier(0.4,0,0.2,1)",
        borderBottom: "1px solid rgba(255,255,255,0.07)",
        marginBottom: 2,
        flexShrink: 0,
      }}
    >
      {/* Logo icon */}
      <div
        style={{
          width: 34,
          height: 34,
          background: `linear-gradient(135deg, ${accent}e6, ${accentGlow}b3)`,
          borderRadius: 9,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "white",
          fontSize: 15,
          flexShrink: 0,
          boxShadow: `0 0 0 1px ${accent}33, 0 4px 12px ${accent}30`,
        }}
      >
        <ApartmentOutlined />
      </div>

      {!collapsed && (
        <div style={{ overflow: "hidden", minWidth: 0 }}>
          <div
            style={{
              fontWeight: 700,
              fontSize: 14,
              color: titleColor,
              letterSpacing: "-0.01em",
              lineHeight: 1.25,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {title}
          </div>
          <div style={{ fontSize: 10.5, color: `${accentGlow}bb`, marginTop: 2, letterSpacing: "0.02em", whiteSpace: "nowrap" }}>
            {subtitle}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Key helpers ────────────────────────────────────────────────────────────────
function getSelectedKey(pathname: string, items: MenuProps["items"]): string {
  if (!items) return pathname;
  let longestMatch = pathname;
  let longestMatchLength = 0;
  const checkItems = (menuItems: MenuProps["items"]) => {
    menuItems?.forEach((item) => {
      if (!item || typeof item !== "object" || !("key" in item)) return;
      const key = (item as { key?: unknown }).key;
      if (typeof key === "string") {
        if (pathname.startsWith(key) && key.length > longestMatchLength) {
          longestMatch = key;
          longestMatchLength = key.length;
        }
      }
      const children = (item as { children?: MenuProps["items"] }).children;
      if (children) checkItems(children);
    });
  };
  checkItems(items);
  return longestMatch;
}

function getTitle(pathname: string, t: (key: string, fallback?: string) => string) {
  if (pathname.startsWith("/admin/dashboard")) return t("layout.adminDashboard");
  if (pathname.startsWith("/admin/users/create")) return t("layout.createUser");
  if (pathname.startsWith("/admin/users")) return t("layout.userManagement");
  if (pathname.startsWith("/admin/invites")) return t("layout.invites");
  if (pathname.startsWith("/admin/audit-logs")) return t("layout.auditLogs");
  if (pathname.startsWith("/admin/workflow/delegations")) return t("layout.delegationRules", "Delegation Rules");
  if (pathname.startsWith("/admin/settings")) return t("layout.systemSettings");
  if (pathname.startsWith("/admin/biotime")) return t("bioTime.pageTitle", "ZKTeco BioTime 8.5 Settings");
  if (pathname.startsWith("/hr/dashboard")) return t("layout.dashboardOverview");
  if (pathname.startsWith("/hr/invites")) return t("layout.invites");
  if (pathname.startsWith("/hr/workflow/delegations")) return t("layout.delegationRules", "Delegation Rules");
  if (pathname.startsWith("/hr")) return t("layout.hrManagement");
  if (pathname.startsWith("/manager/dashboard")) return t("layout.managerDashboard", "Manager Dashboard");
  if (pathname.startsWith("/manager/team-requests")) return t("layout.teamRequests", "Team Requests");
  if (pathname.startsWith("/manager/team")) return t("layout.myTeam", "My Team");
  if (pathname.startsWith("/manager/announcements")) return t("layout.announcements", "Announcements");
  if (pathname.startsWith("/manager/profile")) return t("layout.profile");
  if (pathname.startsWith("/ceo/leave/requests")) return t("layout.ceoLeaveApprovals", "CEO Leave Approvals");
  if (pathname.startsWith("/ceo/team-requests")) return t("layout.teamRequests", "Team Requests");
  if (pathname.startsWith("/ceo/team")) return t("layout.ceoTeam", "Leadership Team");
  if (pathname.startsWith("/ceo/loan-requests")) return t("layout.loanRequests", "Loan Requests");
  if (pathname.startsWith("/ceo/attendance")) return t("layout.attendance");
  if (pathname.startsWith("/ceo/assets")) return t("layout.assets", "Assets");
  if (pathname.startsWith("/ceo/employees/deletion-requests")) return t("employees.removalInbox.title", "Employee Removal Requests");
  if (pathname.startsWith("/ceo/announcements")) return t("layout.announcements", "Announcements");
  if (pathname.startsWith("/ceo/profile")) return t("layout.profile");
  if (pathname.startsWith("/hr/loan-requests")) return t("layout.loanRequests", "Loan Requests");
  if (pathname.startsWith("/hr/assets/lookup")) return t("layout.assetLookup", "Asset Lookup");
  if (pathname.startsWith("/hr/assets/label-jobs")) return t("layout.labelHistory", "Label History");
  if (pathname.startsWith("/hr/assets")) return t("layout.assets", "Assets");
  if (pathname.startsWith("/hr/rents")) return t("layout.rents", "Rents");
  if (pathname.startsWith("/hr/rent-types")) return t("layout.rentTypes", "Rent Types");
  if (pathname.startsWith("/finance/loan-requests")) return t("layout.loanRequests", "Loan Requests");
  if (pathname.startsWith("/manager/loan-requests")) return t("layout.loanRequests", "Loan Requests");
  if (pathname.startsWith("/cfo/loan-requests")) return t("layout.loanRequests", "Loan Requests");
  if (pathname.startsWith("/cfo/profile")) return t("layout.profile");
  if (pathname.startsWith("/employee/loans")) return t("layout.loanRequests", "Loan Requests");
  if (pathname.startsWith("/employee/delegated-approvals")) return t("layout.delegatedApprovals", "Delegated Approvals");
  if (pathname.startsWith("/employee/assets")) return t("layout.myAssets", "My Assets");
  if (pathname.startsWith("/employee/attendance-corrections")) return t("layout.attendanceCorrections", "Attendance Corrections");
  if (pathname.startsWith("/manager/attendance-corrections")) return t("layout.attendanceCorrections", "Attendance Corrections");
  if (pathname.startsWith("/hr/attendance-correction-requests")) return t("layout.attendanceCorrections", "Attendance Corrections");
  if (pathname.startsWith("/pending-inbox")) return t("layout.pendingInbox", "Pending Inbox");
  if (pathname.startsWith("/employee")) return t("layout.employeeSelfService");
  if (pathname.startsWith("/change-password")) return t("layout.changePassword");
  return t("app.title");
}

function getOpenKeysForPath(pathname: string): string[] {
  const opens: string[] = [];
  const isEmployeeRequestPath =
    pathname.startsWith("/employee/leave") || pathname.startsWith("/employee/loans");
  const isHrInboxPath =
    pathname.startsWith("/hr/leave/requests") || pathname.startsWith("/hr/loan-requests");

  // HR sidebar sub-menus
  if (pathname.startsWith("/hr/assets")) opens.push("hr-assets-sub");
  if (pathname.startsWith("/hr/rents") || pathname.startsWith("/hr/rent-types")) opens.push("hr-rents-sub");
  if (pathname.startsWith("/hr/announcements")) opens.push("hr-announcements-sub");
  if (isHrInboxPath) opens.push("hr-inbox-sub");
  if (isEmployeeRequestPath) opens.push("hr-emp-requests-sub");
  if (pathname.startsWith("/hr/attendance") || pathname.startsWith("/hr/attendance-correction-requests")) opens.push("hr-attendance-sub");
  if (pathname.startsWith("/employee/attendance") || pathname.startsWith("/employee/attendance-corrections")) opens.push("hr-emp-attendance-sub");
  // Employee sidebar sub-menus
  if (isEmployeeRequestPath) opens.push("emp-requests-sub");
  if (pathname.startsWith("/employee/attendance") || pathname.startsWith("/employee/attendance-corrections")) opens.push("emp-attendance-sub");
  // Manager sidebar sub-menus
  if (isEmployeeRequestPath) opens.push("mgr-requests-sub");
  if (pathname.startsWith("/manager/announcements") || pathname.startsWith("/employee/announcements")) opens.push("mgr-announcements-sub");
  if (pathname.startsWith("/employee/attendance") || pathname.startsWith("/employee/attendance-corrections")) opens.push("mgr-attendance-sub");
  // CEO sidebar sub-menus
  if (pathname.startsWith("/ceo/assets")) opens.push("ceo-assets-sub");
  if (pathname.startsWith("/ceo/announcements")) opens.push("ceo-announcements-sub");
  return opens;
}

// ─── Avatar color by role ───────────────────────────────────────────────────────
function roleColor(role?: string) {
  const map: Record<string, string> = {
    SystemAdmin: "#ef4444",
    HRManager: "#f97316",
    Manager: "#ff7a45",
    CEO: "#f59e0b",
    CFO: "#10b981",
    Employee: "#94a3b8",
  };
  return map[role || ""] || "#94a3b8";
}

function getOrganizationTheme(code?: string, nodeType?: string) {
  if (nodeType === "head_office") {
    return {
      shellBg: "linear-gradient(135deg, rgba(255,255,255,0.98), rgba(245,247,250,0.96))",
      shellBorder: "rgba(148, 163, 184, 0.22)",
      shellShadow: "0 14px 34px rgba(15, 23, 42, 0.08)",
      shellInset: "inset 0 1px 0 rgba(255,255,255,0.75)",
      text: "#0f172a",
      muted: "#64748b",
      selectBg: "linear-gradient(135deg, #ffffff, #f8fafc)",
      selectBorder: "rgba(148, 163, 184, 0.28)",
      selectShadow: "0 8px 18px rgba(148, 163, 184, 0.14)",
      accent: "#475569",
      accentSoft: "rgba(71, 85, 105, 0.12)",
      divider: "rgba(148, 163, 184, 0.22)",
    };
  }

  switch (code) {
    case "ASECO_PRO":
      return {
        shellBg: "linear-gradient(135deg, rgba(255,248,233,0.98), rgba(250,232,190,0.96))",
        shellBorder: "rgba(194, 138, 27, 0.28)",
        shellShadow: "0 16px 34px rgba(184, 134, 11, 0.18)",
        shellInset: "inset 0 1px 0 rgba(255,255,255,0.68)",
        text: "#5b3b00",
        muted: "#8a670f",
        selectBg: "linear-gradient(135deg, #fff8eb, #f2d27d)",
        selectBorder: "rgba(168, 118, 14, 0.34)",
        selectShadow: "0 10px 22px rgba(194, 138, 27, 0.18)",
        accent: "#a16207",
        accentSoft: "rgba(161, 98, 7, 0.14)",
        divider: "rgba(194, 138, 27, 0.24)",
      };
    case "ATHROYA":
      return {
        shellBg: "linear-gradient(135deg, rgba(15,23,42,0.97), rgba(30,41,59,0.95))",
        shellBorder: "rgba(148, 163, 184, 0.16)",
        shellShadow: "0 18px 38px rgba(15, 23, 42, 0.28)",
        shellInset: "inset 0 1px 0 rgba(255,255,255,0.08)",
        text: "#f8fafc",
        muted: "rgba(226,232,240,0.72)",
        selectBg: "linear-gradient(135deg, rgba(30,41,59,0.98), rgba(15,23,42,0.98))",
        selectBorder: "rgba(226, 232, 240, 0.14)",
        selectShadow: "0 10px 22px rgba(2, 6, 23, 0.32)",
        accent: "#f8fafc",
        accentSoft: "rgba(248, 250, 252, 0.10)",
        divider: "rgba(226, 232, 240, 0.12)",
      };
    case "FFI":
    default:
      return {
        shellBg: "linear-gradient(135deg, rgba(255,255,255,0.98), rgba(248,250,252,0.98))",
        shellBorder: "rgba(226, 232, 240, 0.92)",
        shellShadow: "0 14px 32px rgba(15, 23, 42, 0.07)",
        shellInset: "inset 0 1px 0 rgba(255,255,255,0.92)",
        text: "#0f172a",
        muted: "#64748b",
        selectBg: "linear-gradient(135deg, #ffffff, #f8fafc)",
        selectBorder: "rgba(226, 232, 240, 0.95)",
        selectShadow: "0 8px 18px rgba(148, 163, 184, 0.14)",
        accent: "#f97316",
        accentSoft: "rgba(249, 115, 22, 0.10)",
        divider: "rgba(226, 232, 240, 0.9)",
      };
  }
}

// ─── Per-org sidebar theme (CSS custom properties + computed values) ────────────
function getSidebarTheme(code?: string, nodeType?: string) {
  if (nodeType === "head_office") {
    return {
      bg: "#0a0d1a",
      border: "rgba(99,102,241,0.14)",
      accent: "#6366f1",
      accentText: "#a5b4fc",
      activeBg: "rgba(99,102,241,0.11)",
      hoverBg: "rgba(99,102,241,0.06)",
      sectionColor: "rgba(165,180,252,0.48)",
    };
  }
  switch (code) {
    case "ASECO_PRO":
      return {
        bg: "#0c0a06",
        border: "rgba(212,160,23,0.14)",
        accent: "#d4a017",
        accentText: "#f6c453",
        activeBg: "rgba(212,160,23,0.12)",
        hoverBg: "rgba(212,160,23,0.06)",
        sectionColor: "rgba(246,196,83,0.5)",
      };
    case "ATHROYA":
      return {
        bg: "#07090d",
        border: "rgba(148,163,184,0.10)",
        accent: "#94a3b8",
        accentText: "#cbd5e1",
        activeBg: "rgba(148,163,184,0.10)",
        hoverBg: "rgba(148,163,184,0.06)",
        sectionColor: "rgba(148,163,184,0.42)",
      };
    case "FFI":
    default:
      return {
        bg: "#0d1117",
        border: "rgba(249,115,22,0.12)",
        accent: "#f97316",
        accentText: "#fb923c",
        activeBg: "rgba(249,115,22,0.12)",
        hoverBg: "rgba(249,115,22,0.06)",
        sectionColor: "rgba(249,115,22,0.5)",
      };
  }
}

function getRoleLabel(role?: string): string {
  const map: Record<string, string> = {
    SystemAdmin: "System Admin",
    HRManager: "HR Manager",
    Manager: "Manager",
    CEO: "CEO",
    CFO: "CFO",
    Employee: "Employee",
  };
  return map[role || ""] || role || "";
}

function getSidebarBrandTheme(code?: string, nodeType?: string) {
  if (nodeType === "head_office") {
    return {
      accent: "#e2e8f0",
      accentGlow: "#94a3b8",
      titleColor: "#f8fafc",
    };
  }

  switch (code) {
    case "ASECO_PRO":
      return {
        accent: "#d4a017",
        accentGlow: "#f6c453",
        titleColor: "#fff7db",
      };
    case "ATHROYA":
      return {
        accent: "#0f172a",
        accentGlow: "#94a3b8",
        titleColor: "#f8fafc",
      };
    case "FFI":
    default:
      return {
        accent: "#f97316",
        accentGlow: "#fb923c",
        titleColor: "#ffffff",
      };
  }
}

function sectionLabel(title: string, caption?: string) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <span>{title}</span>
      {caption ? (
        <span style={{ fontSize: 10, letterSpacing: "0.04em", textTransform: "none", opacity: 0.7 }}>{caption}</span>
      ) : null}
    </div>
  );
}

// ─── Main Layout ────────────────────────────────────────────────────────────────
export default function BaseLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const setActiveOrganization = useAuthStore((s) => s.setActiveOrganization);
  const logout = useAuthStore((s) => s.logout);
  const { t, language, setLanguage, direction } = useI18n();

  const screens = useBreakpoint();
  const isMobile = !screens.md;

  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('ffi_sidebar_collapsed') === 'true');
  const [isFinanceApprover, setIsFinanceApprover] = useState(false);
  const [isCFOApprover, setIsCFOApprover] = useState(false);
  const [isCEOApprover, setIsCEOApprover] = useState(false);
  const [hasManagerAccess, setHasManagerAccess] = useState(false);
  const [isSwitchingOrganization, setIsSwitchingOrganization] = useState(false);
  const [openMenuKeys, setOpenMenuKeys] = useState<string[]>(() => getOpenKeysForPath(location.pathname));

  useEffect(() => {
    const pathKeys = getOpenKeysForPath(location.pathname);
    if (pathKeys.length > 0) {
      setOpenMenuKeys((prev) => Array.from(new Set([...prev, ...pathKeys])));
    }
    setMobileMenuOpen(false);
  }, [location.pathname]);

  const role = user?.role;
  const organizations = user?.accessible_organizations ?? [];
  const activeOrganizationId = user?.active_organization_id ?? user?.default_organization_id ?? null;
  const activeOrganization = organizations.find((organization) => String(organization.id) === String(activeOrganizationId));
  const organizationTheme = getOrganizationTheme(activeOrganization?.code, activeOrganization?.node_type);
  const sidebarBrandTheme = getSidebarBrandTheme(activeOrganization?.code, activeOrganization?.node_type);
  const sbTheme = getSidebarTheme(activeOrganization?.code, activeOrganization?.node_type);
  const sidebarCSSVars = {
    "--sb-bg": sbTheme.bg,
    "--sb-border": sbTheme.border,
    "--sb-accent": sbTheme.accent,
    "--sb-accent-text": sbTheme.accentText,
    "--sb-active-bg": sbTheme.activeBg,
    "--sb-hover-bg": sbTheme.hoverBg,
    "--sb-section-color": sbTheme.sectionColor,
  } as React.CSSProperties;
  const isHeadOffice = isHeadOfficeOrganization(user);
  const brandTitle = useMemo(() => {
    if (!activeOrganization?.name) return "FFISYS";
    return activeOrganization.node_type === "head_office" ? "Main Head Office" : activeOrganization.name;
  }, [activeOrganization]);

  const handleOrganizationChange = (organizationId: string | number) => {
    if (String(organizationId) === String(activeOrganizationId)) return;
    setIsSwitchingOrganization(true);
    setActiveOrganization(organizationId);
    window.setTimeout(() => {
      window.location.reload();
    }, 120);
  };

  useEffect(() => {
    let mounted = true;
    async function loadFinanceEligibility() {
      if (role !== "Employee") {
        if (mounted) {
          setIsFinanceApprover(false);
          setIsCFOApprover(false);
          setIsCEOApprover(false);
          setHasManagerAccess(false);
        }
        return;
      }
      try {
        const [profileRes, managerRes] = await Promise.allSettled([getEmployee("me"), getManagerAccess()]);
        if (!mounted) return;
        const resolvedProfile =
          profileRes.status === "fulfilled" ? profileRes.value : null;
        const resolvedManager =
          managerRes.status === "fulfilled" ? managerRes.value : null;

        if (!resolvedProfile || isApiError(resolvedProfile)) {
          setIsFinanceApprover(false);
          setIsCFOApprover(false);
          setIsCEOApprover(false);
          setHasManagerAccess(Boolean(resolvedManager && !isApiError(resolvedManager) && resolvedManager.data.has_access));
        } else {
          setIsFinanceApprover(isFinanceApproverEmployee(resolvedProfile.data));
          setIsCFOApprover(isCFOApproverEmployee(resolvedProfile.data));
          setIsCEOApprover(isCEOApproverEmployee(resolvedProfile.data));
          setHasManagerAccess(Boolean(resolvedManager && !isApiError(resolvedManager) && resolvedManager.data.has_access));
        }
      } catch {
        if (mounted) {
          setIsFinanceApprover(false);
          setIsCFOApprover(false);
          setIsCEOApprover(false);
          setHasManagerAccess(false);
        }
      }
    }
    loadFinanceEligibility();
    return () => { mounted = false; };
  }, [role]);

  // ─── Menu definitions ──────────────────────────────────────────────────────
  const adminItems: MenuProps["items"] = [
    {
      type: "group",
      label: sectionLabel(t("layout.dashboard"), t("layout.menu.operations", "Operations")),
      children: [
        { key: "/admin/dashboard", icon: <DashboardOutlined />, label: <Link to="/admin/dashboard">{t("layout.dashboard")}</Link> },
        { key: "/admin/announcements", icon: <BellOutlined />, label: <Link to="/admin/announcements">{t("layout.announcements", "Announcements")}</Link> },
        { key: "/admin/audit-logs", icon: <FileSearchOutlined />, label: <Link to="/admin/audit-logs">{t("layout.auditLogs")}</Link> },
        { key: "/admin/workflow/delegations", icon: <UserSwitchOutlined />, label: <Link to="/admin/workflow/delegations">{t("layout.delegationRules", "Delegation Rules")}</Link> },
        { key: "/admin/settings", icon: <SettingOutlined />, label: <Link to="/admin/settings">{t("layout.settings")}</Link> },
        { key: "/admin/biotime", icon: <SettingOutlined />, label: <Link to="/admin/biotime">{t("bioTime.pageTitle", "BioTime Settings")}</Link> },
      ],
    },
    {
      type: "group",
      label: sectionLabel(t("layout.users"), t("layout.menu.peopleOrg", "People & Organization")),
      children: [
        { key: "/admin/users", icon: <TeamOutlined />, label: <Link to="/admin/users">{t("layout.users")}</Link> },
        { key: "/admin/users/create", icon: <UserAddOutlined />, label: <Link to="/admin/users/create">{t("layout.createUser")}</Link> },
        { key: "/admin/invites", icon: <UserAddOutlined />, label: <Link to="/admin/invites">{t("layout.invites")}</Link> },
      ],
    },
    {
      type: "group",
      label: sectionLabel(t("layout.profile"), t("layout.menu.account", "Account")),
      children: [{ key: "/admin/profile", icon: <IdcardOutlined />, label: <Link to="/admin/profile">{t("layout.profile")}</Link> }],
    },
  ];

  const hrItems: MenuProps["items"] = [
    { key: "/hr/dashboard", icon: <DashboardOutlined />, label: <Link to="/hr/dashboard">{t("layout.dashboard")}</Link> },
    { key: "/hr/invites", icon: <UserAddOutlined />, label: <Link to="/hr/invites">{t("layout.invites")}</Link> },
    {
      type: "group",
      label: sectionLabel(t("layout.menu.workInbox", "Work Inbox"), t("layout.menu.approvals", "Approvals")),
      children: [
        { key: "/pending-inbox", icon: <InboxOutlined />, label: <Link to="/pending-inbox">{t("layout.pendingInbox", "Pending Inbox")}</Link> },
        {
          key: "hr-inbox-sub",
          icon: <InboxOutlined />,
          label: t("layout.inbox", "Inbox"),
          children: [
            { key: "/hr/leave/requests", label: <Link to="/hr/leave/requests">{t("layout.leaveInbox")}</Link> },
            { key: "/hr/loan-requests", label: <Link to="/hr/loan-requests">{t("layout.loanInbox", "Loan Inbox")}</Link> },
          ],
        },
        {
          key: "hr-attendance-sub",
          icon: <ClockCircleOutlined />,
          label: t("layout.attendance"),
          children: [
            { key: "/hr/attendance", label: <Link to="/hr/attendance">{t("layout.attendanceRecords", "Records")}</Link> },
            { key: "/hr/attendance-correction-requests", label: <Link to="/hr/attendance-correction-requests">{t("layout.attendanceCorrections", "Attendance Corrections")}</Link> },
          ],
        },
        { key: "/hr/workflow/delegations", icon: <UserSwitchOutlined />, label: <Link to="/hr/workflow/delegations">{t("layout.delegationRules", "Delegation Rules")}</Link> },
      ],
    },
    {
      type: "group",
      label: sectionLabel(t("layout.menu.myRequests", "My Requests"), t("layout.employeeSelfService")),
      children: [
        {
          key: "hr-emp-requests-sub",
          icon: <FileSearchOutlined />,
          label: t("layout.requests", "Requests"),
          children: [
            { key: "/employee/leave/request", label: <Link to="/employee/leave/request">{t("layout.requestLeave", "Request Leave")}</Link> },
            { key: "/employee/leave/requests", label: <Link to="/employee/leave/requests">{t("layout.myLeaveRequests", "My Leave Requests")}</Link> },
            { key: "/employee/loans/request", label: <Link to="/employee/loans/request">{t("layout.newLoan", "New Loan")}</Link> },
            { key: "/employee/loans", label: <Link to="/employee/loans">{t("layout.myLoans", "My Loans")}</Link> },
          ],
        },
        { key: "/employee/delegated-approvals", icon: <UserSwitchOutlined />, label: <Link to="/employee/delegated-approvals">{t("layout.delegatedApprovals", "Delegated Approvals")}</Link> },
        {
          key: "hr-emp-attendance-sub",
          icon: <ClockCircleOutlined />,
          label: t("layout.attendance"),
          children: [
            { key: "/employee/attendance", label: <Link to="/employee/attendance">{t("layout.attendanceRecords", "Records")}</Link> },
            { key: "/employee/attendance-corrections", label: <Link to="/employee/attendance-corrections">{t("layout.attendanceCorrections", "Attendance Corrections")}</Link> },
          ],
        },
        { key: "/employee/assets", icon: <AppstoreOutlined />, label: <Link to="/employee/assets">{t("layout.myAssets", "My Assets")}</Link> },
      ],
    },
    {
      type: "group",
      label: sectionLabel(t("layout.menu.people", "People"), t("layout.employees")),
      children: [
        { key: "/hr/employees", icon: <TeamOutlined />, label: <Link to="/hr/employees">{t("layout.employees")}</Link> },
        { key: "/hr/departments", icon: <ApartmentOutlined />, label: <Link to="/hr/departments">{t("layout.departments")}</Link> },
        { key: "/hr/positions", icon: <IdcardOutlined />, label: <Link to="/hr/positions">{t("layout.positions")}</Link> },
        { key: "/hr/task-groups", icon: <GroupOutlined />, label: <Link to="/hr/task-groups">{t("layout.taskGroups")}</Link> },
        { key: "/hr/sponsors", icon: <SafetyOutlined />, label: <Link to="/hr/sponsors">{t("layout.sponsors")}</Link> },
      ],
    },
    {
      type: "group",
      label: sectionLabel(t("layout.menu.operations", "Operations"), t("layout.payroll")),
      children: [
        { key: "/hr/import/employees", icon: <UploadOutlined />, label: <Link to="/hr/import/employees">{t("layout.importEmployees")}</Link> },
        { key: "/hr/payroll", icon: <DollarOutlined />, label: <Link to="/hr/payroll">{t("layout.payroll")}</Link> },
        {
          key: "hr-assets-sub",
          icon: <AppstoreOutlined />,
          label: t("layout.assets", "Assets"),
          children: [
            { key: "/hr/assets", label: <Link to="/hr/assets">{t("layout.assetList", "List")}</Link> },
            { key: "/hr/assets/lookup", label: <Link to="/hr/assets/lookup">{t("layout.assetLookup", "Lookup")}</Link> },
            { key: "/hr/assets/label-jobs", label: <Link to="/hr/assets/label-jobs">{t("layout.assetLabels", "Labels")}</Link> },
          ],
        },
        {
          key: "hr-rents-sub",
          icon: <HomeOutlined />,
          label: t("layout.rents", "Rents"),
          children: [
            { key: "/hr/rents", label: <Link to="/hr/rents">{t("layout.rentList", "List")}</Link> },
            { key: "/hr/rent-types", label: <Link to="/hr/rent-types">{t("layout.rentTypes", "Rent Types")}</Link> },
          ],
        },
        { key: "/hr/templates", icon: <FileTextOutlined />, label: <Link to="/hr/templates">{t("layout.templateLibrary", "Template Library")}</Link> },
        {
          key: "hr-announcements-sub",
          icon: <BellOutlined />,
          label: t("layout.announcements", "Announcements"),
          children: [
            { key: "/hr/announcements", label: <Link to="/hr/announcements">{t("layout.announcements", "Announcements")}</Link> },
            { key: "/hr/announcements/create", label: <Link to="/hr/announcements/create">{t("layout.newAnnouncement", "New")}</Link> },
          ],
        },
      ],
    },
    {
      type: "group",
      label: sectionLabel(t("layout.menu.account", "Account"), t("layout.profile")),
      children: [
        { key: "/hr/profile", icon: <IdcardOutlined />, label: <Link to="/hr/profile">{t("layout.profile")}</Link> },
      ],
    },
  ];

  const employeeItems: MenuProps["items"] = [
    { key: "/employee/home", icon: <DashboardOutlined />, label: <Link to="/employee/home">{t("layout.home")}</Link> },
    {
      type: "group",
      label: sectionLabel(t("layout.menu.myRequests", "My Requests"), t("layout.employeeSelfService")),
      children: [
        {
          key: "emp-attendance-sub",
          icon: <ClockCircleOutlined />,
          label: t("layout.attendance"),
          children: [
            { key: "/employee/attendance", label: <Link to="/employee/attendance">{t("layout.attendanceRecords", "Records")}</Link> },
            { key: "/employee/attendance-corrections", label: <Link to="/employee/attendance-corrections">{t("layout.attendanceCorrections", "Attendance Corrections")}</Link> },
          ],
        },
        {
          key: "emp-requests-sub",
          icon: <FileSearchOutlined />,
          label: t("layout.requests", "Requests"),
          children: [
            { key: "/employee/leave/balance", label: <Link to="/employee/leave/balance">{t("layout.leaveBalance")}</Link> },
            { key: "/employee/leave/requests", label: <Link to="/employee/leave/requests">{t("layout.myLeaveRequests", "My Leave Requests")}</Link> },
            { key: "/employee/loans", label: <Link to="/employee/loans">{t("layout.myLoans", "My Loans")}</Link> },
          ],
        },
        { key: "/employee/delegated-approvals", icon: <UserSwitchOutlined />, label: <Link to="/employee/delegated-approvals">{t("layout.delegatedApprovals", "Delegated Approvals")}</Link> },
        { key: "/employee/assets", icon: <AppstoreOutlined />, label: <Link to="/employee/assets">{t("layout.myAssets", "My Assets")}</Link> },
        { key: "/employee/payslips", icon: <FileTextOutlined />, label: <Link to="/employee/payslips">{t("layout.myPayslips")}</Link> },
      ],
    },
    ...(hasManagerAccess || isFinanceApprover || isCFOApprover || isCEOApprover
      ? [
        {
          type: "group" as const,
          label: sectionLabel(t("layout.menu.workInbox", "Work Inbox"), t("layout.menu.approvals", "Approvals")),
          children: [
            { key: "/pending-inbox", icon: <InboxOutlined />, label: <Link to="/pending-inbox">{t("layout.pendingInbox", "Pending Inbox")}</Link> },
          ],
        },
      ]
      : []),
    ...(hasManagerAccess
      ? [
        {
          type: "group" as const,
          label: sectionLabel(t("layout.menu.manager", "Manager"), t("layout.menu.teamManagement", "Team Management")),
          children: [
            { key: "/manager/dashboard", icon: <DashboardOutlined />, label: <Link to="/manager/dashboard">{t("layout.managerDashboard", "Manager Dashboard")}</Link> },
            { key: "/manager/team", icon: <TeamOutlined />, label: <Link to="/manager/team">{t("layout.myTeam", "My Team")}</Link> },
            { key: "/manager/team-requests", icon: <FileSearchOutlined />, label: <Link to="/manager/team-requests">{t("layout.teamRequests", "Team Requests")}</Link> },
            { key: "/manager/attendance-corrections", icon: <ClockCircleOutlined />, label: <Link to="/manager/attendance-corrections">{t("layout.attendanceCorrections", "Attendance Corrections")}</Link> },
            { key: "/manager/loan-requests", icon: <DollarOutlined />, label: <Link to="/manager/loan-requests">{t("layout.loanRequests", "Loan Requests")}</Link> },
          ],
        },
      ]
      : []),
    ...(isFinanceApprover
      ? [
        {
          type: "group" as const,
          label: sectionLabel(t("layout.menu.finance", "Finance"), t("layout.menu.approvals", "Approvals")),
          children: [
            { key: "/finance/loan-requests", icon: <DollarOutlined />, label: <Link to="/finance/loan-requests">{t("layout.loanInbox", "Loan Inbox")}</Link> },
          ],
        },
      ]
      : []),
    ...(isCFOApprover
      ? [
        {
          type: "group" as const,
          label: sectionLabel(t("layout.menu.cfo", "CFO"), t("layout.menu.finance", "Finance")),
          children: [
            { key: "/cfo/loan-requests", icon: <DollarOutlined />, label: <Link to="/cfo/loan-requests">{t("layout.cfoLoanInbox", "CFO Loan Inbox")}</Link> },
          ],
        },
      ]
      : []),
    ...(isCEOApprover
      ? [
        {
          type: "group" as const,
          label: sectionLabel(t("layout.menu.ceo", "CEO"), t("layout.menu.approvals", "Approvals")),
          children: [
            { key: "/ceo/loan-requests", icon: <DollarOutlined />, label: <Link to="/ceo/loan-requests">{t("layout.loanRequests", "Loan Requests")}</Link> },
            { key: "/ceo/attendance", icon: <ClockCircleOutlined />, label: <Link to="/ceo/attendance">{t("layout.attendance")}</Link> },
            { key: "/ceo/assets/damage-reports", icon: <AppstoreOutlined />, label: <Link to="/ceo/assets/damage-reports">{t("assets.damageReports", "Damage Reports")}</Link> },
            { key: "/ceo/assets/return-requests", icon: <AppstoreOutlined />, label: <Link to="/ceo/assets/return-requests">{t("assets.returnRequests", "Return Requests")}</Link> },
            { key: "/ceo/employees/deletion-requests", icon: <TeamOutlined />, label: <Link to="/ceo/employees/deletion-requests">{t("employees.removalInbox.menu", "Employee Removals")}</Link> },
          ],
        },
      ]
      : []),
    {
      type: "group",
      label: sectionLabel(t("layout.menu.account", "Account"), t("layout.profile")),
      children: [
        { key: "/employee/announcements", icon: <BellOutlined />, label: <Link to="/employee/announcements">{t("layout.announcements", "Announcements")}</Link> },
        { key: "/employee/profile", icon: <IdcardOutlined />, label: <Link to="/employee/profile">{t("layout.profile")}</Link> },
      ],
    },
  ];

  const managerItems: MenuProps["items"] = [
    { key: "/employee/home", icon: <DashboardOutlined />, label: <Link to="/employee/home">{t("layout.home")}</Link> },
    {
      type: "group",
      label: sectionLabel(t("layout.menu.myRequests", "My Requests"), t("layout.employeeSelfService")),
      children: [
        {
          key: "mgr-attendance-sub",
          icon: <ClockCircleOutlined />,
          label: t("layout.attendance"),
          children: [
            { key: "/employee/attendance", label: <Link to="/employee/attendance">{t("layout.attendanceRecords", "Records")}</Link> },
            { key: "/employee/attendance-corrections", label: <Link to="/employee/attendance-corrections">{t("layout.attendanceCorrections", "Attendance Corrections")}</Link> },
          ],
        },
        {
          key: "mgr-requests-sub",
          icon: <FileSearchOutlined />,
          label: t("layout.requests", "Requests"),
          children: [
            { key: "/employee/leave/balance", label: <Link to="/employee/leave/balance">{t("layout.leaveBalance")}</Link> },
            { key: "/employee/leave/request", label: <Link to="/employee/leave/request">{t("layout.requestLeave", "Request Leave")}</Link> },
            { key: "/employee/leave/requests", label: <Link to="/employee/leave/requests">{t("layout.myLeaveRequests", "My Leave Requests")}</Link> },
            { key: "/employee/loans/request", label: <Link to="/employee/loans/request">{t("layout.newLoan", "New Loan")}</Link> },
            { key: "/employee/loans", label: <Link to="/employee/loans">{t("layout.myLoans", "My Loans")}</Link> },
          ],
        },
        { key: "/employee/delegated-approvals", icon: <UserSwitchOutlined />, label: <Link to="/employee/delegated-approvals">{t("layout.delegatedApprovals", "Delegated Approvals")}</Link> },
        { key: "/employee/assets", icon: <AppstoreOutlined />, label: <Link to="/employee/assets">{t("layout.myAssets", "My Assets")}</Link> },
        { key: "/employee/payslips", icon: <FileTextOutlined />, label: <Link to="/employee/payslips">{t("layout.myPayslips")}</Link> },
      ],
    },
    {
      type: "group",
      label: sectionLabel(t("layout.menu.workInbox", "Work Inbox"), t("layout.menu.approvals", "Approvals")),
      children: [
        { key: "/pending-inbox", icon: <InboxOutlined />, label: <Link to="/pending-inbox">{t("layout.pendingInbox", "Pending Inbox")}</Link> },
      ],
    },
    {
      type: "group",
      label: sectionLabel(t("layout.menu.manager", "Manager"), t("layout.menu.teamManagement", "Team Management")),
      children: [
        { key: "/manager/dashboard", icon: <DashboardOutlined />, label: <Link to="/manager/dashboard">{t("layout.managerDashboard", "Manager Dashboard")}</Link> },
        { key: "/manager/team", icon: <TeamOutlined />, label: <Link to="/manager/team">{t("layout.myTeam", "My Team")}</Link> },
        { key: "/manager/team-requests", icon: <FileSearchOutlined />, label: <Link to="/manager/team-requests">{t("layout.teamRequests", "Team Requests")}</Link> },
        { key: "/manager/attendance-corrections", icon: <ClockCircleOutlined />, label: <Link to="/manager/attendance-corrections">{t("layout.attendanceCorrections", "Attendance Corrections")}</Link> },
        { key: "/manager/loan-requests", icon: <DollarOutlined />, label: <Link to="/manager/loan-requests">{t("layout.loanRequests", "Loan Requests")}</Link> },
      ],
    },
    {
      type: "group",
      label: sectionLabel(t("layout.menu.account", "Account"), t("layout.profile")),
      children: [
        {
          key: "mgr-announcements-sub",
          icon: <BellOutlined />,
          label: t("layout.announcements", "Announcements"),
          children: [
            { key: "/employee/announcements", label: <Link to="/employee/announcements">{t("layout.myFeed", "My Feed")}</Link> },
            { key: "/manager/announcements", label: <Link to="/manager/announcements">{t("layout.manage", "Manage")}</Link> },
            { key: "/manager/announcements/create", label: <Link to="/manager/announcements/create">{t("layout.newAnnouncement", "New")}</Link> },
          ],
        },
        { key: "/manager/profile", icon: <IdcardOutlined />, label: <Link to="/manager/profile">{t("layout.profile")}</Link> },
      ],
    },
  ];

  const ceoItems: MenuProps["items"] = [
    { key: "/ceo/dashboard", icon: <DashboardOutlined />, label: <Link to="/ceo/dashboard">{t("layout.dashboard")}</Link> },
    {
      type: "group",
      label: sectionLabel(t("layout.menu.workInbox", "Work Inbox"), t("layout.menu.approvals", "Approvals")),
      children: [
        { key: "/pending-inbox", icon: <InboxOutlined />, label: <Link to="/pending-inbox">{t("layout.pendingInbox", "Pending Inbox")}</Link> },
      ],
    },
    {
      type: "group",
      label: sectionLabel(t("layout.menu.ceo", "CEO"), t("layout.menu.approvals", "Approvals")),
      children: [
        { key: "/ceo/leave/requests", icon: <CalendarOutlined />, label: <Link to="/ceo/leave/requests">{t("layout.ceoLeaveApprovals", "Leave Approvals")}</Link> },
        { key: "/ceo/team-requests", icon: <FileSearchOutlined />, label: <Link to="/ceo/team-requests">{t("layout.teamRequests", "Team Requests")}</Link> },
        { key: "/ceo/loan-requests", icon: <DollarOutlined />, label: <Link to="/ceo/loan-requests">{t("layout.loanRequests", "Loan Requests")}</Link> },
        { key: "/ceo/attendance", icon: <ClockCircleOutlined />, label: <Link to="/ceo/attendance">{t("layout.attendance")}</Link> },
        {
          key: "ceo-assets-sub",
          icon: <AppstoreOutlined />,
          label: t("layout.assetReviews", "Asset Reviews"),
          children: [
            { key: "/ceo/assets/damage-reports", label: <Link to="/ceo/assets/damage-reports">{t("assets.damageReports", "Damage Reports")}</Link> },
            { key: "/ceo/assets/return-requests", label: <Link to="/ceo/assets/return-requests">{t("assets.returnRequests", "Return Requests")}</Link> },
          ],
        },
        { key: "/ceo/employees/deletion-requests", icon: <TeamOutlined />, label: <Link to="/ceo/employees/deletion-requests">{t("employees.removalInbox.menu", "Employee Removals")}</Link> },
      ],
    },
    {
      type: "group",
      label: sectionLabel(t("layout.menu.manager", "Manager"), t("layout.menu.teamManagement", "Team Management")),
      children: [
        { key: "/manager/dashboard", icon: <DashboardOutlined />, label: <Link to="/manager/dashboard">{t("layout.managerDashboard", "Manager Dashboard")}</Link> },
        { key: "/manager/team", icon: <TeamOutlined />, label: <Link to="/manager/team">{t("layout.myTeam", "My Team")}</Link> },
        { key: "/manager/team-requests", icon: <FileSearchOutlined />, label: <Link to="/manager/team-requests">{t("layout.teamRequests", "Team Requests")}</Link> },
        { key: "/manager/loan-requests", icon: <DollarOutlined />, label: <Link to="/manager/loan-requests">{t("layout.loanRequests", "Loan Requests")}</Link> },
      ],
    },
    {
      type: "group",
      label: sectionLabel(t("layout.myTeam", "My Team"), t("layout.leadership", "Leadership")),
      children: [
        { key: "/ceo/team", icon: <TeamOutlined />, label: <Link to="/ceo/team">{t("layout.ceoTeam", "Leadership Team")}</Link> },
      ],
    },
    {
      type: "group",
      label: sectionLabel(t("layout.menu.account", "Account"), t("layout.profile")),
      children: [
        {
          key: "ceo-announcements-sub",
          icon: <BellOutlined />,
          label: t("layout.announcements", "Announcements"),
          children: [
            { key: "/ceo/announcements", label: <Link to="/ceo/announcements">{t("layout.announcements", "Announcements")}</Link> },
            { key: "/ceo/announcements/create", label: <Link to="/ceo/announcements/create">{t("layout.newAnnouncement", "New")}</Link> },
          ],
        },
        { key: "/ceo/profile", icon: <IdcardOutlined />, label: <Link to="/ceo/profile">{t("layout.profile")}</Link> },
      ],
    },
  ];

  const cfoItems: MenuProps["items"] = [
    { key: "/cfo/dashboard", icon: <DashboardOutlined />, label: <Link to="/cfo/dashboard">{t("layout.dashboard")}</Link> },
    {
      type: "group",
      label: sectionLabel(t("layout.menu.workInbox", "Work Inbox"), t("layout.menu.approvals", "Approvals")),
      children: [
        { key: "/pending-inbox", icon: <InboxOutlined />, label: <Link to="/pending-inbox">{t("layout.pendingInbox", "Pending Inbox")}</Link> },
      ],
    },
    {
      type: "group",
      label: sectionLabel(t("layout.menu.cfo", "CFO"), t("layout.menu.finance", "Finance")),
      children: [
        { key: "/cfo/loan-requests", icon: <DollarOutlined />, label: <Link to="/cfo/loan-requests">{t("layout.loanRequests", "Loan Requests")}</Link> },
      ],
    },
    {
      type: "group",
      label: sectionLabel(t("layout.menu.manager", "Manager"), t("layout.menu.teamManagement", "Team Management")),
      children: [
        { key: "/manager/dashboard", icon: <DashboardOutlined />, label: <Link to="/manager/dashboard">{t("layout.managerDashboard", "Manager Dashboard")}</Link> },
        { key: "/manager/team", icon: <TeamOutlined />, label: <Link to="/manager/team">{t("layout.myTeam", "My Team")}</Link> },
        { key: "/manager/team-requests", icon: <FileSearchOutlined />, label: <Link to="/manager/team-requests">{t("layout.teamRequests", "Team Requests")}</Link> },
        { key: "/manager/loan-requests", icon: <DollarOutlined />, label: <Link to="/manager/loan-requests">{t("layout.loanRequests", "Loan Requests")}</Link> },
      ],
    },
    {
      type: "group",
      label: sectionLabel(t("layout.menu.account", "Account"), t("layout.profile")),
      children: [{ key: "/cfo/profile", icon: <IdcardOutlined />, label: <Link to="/cfo/profile">{t("layout.profile")}</Link> }],
    },
  ];

  const menuItems =
    role === "SystemAdmin" ? adminItems
      : role === "HRManager" ? hrItems
        : role === "Manager" ? managerItems
          : role === "CEO" ? ceoItems
            : role === "CFO" ? cfoItems
              : role === "Employee"
                ? employeeItems
                : [];

  // ─── User dropdown menu ────────────────────────────────────────────────────
  const userMenu: MenuProps = {
    items: [
      {
        key: "user-info",
        label: (
          <div style={{ padding: "4px 0" }}>
            <div style={{ fontWeight: 600, fontSize: 14, color: "#0f172a" }}>
              {user?.email?.split("@")[0] || "User"}
            </div>
            <div style={{ fontSize: 12, color: "#94a3b8" }}>{user?.email}</div>
          </div>
        ),
        disabled: true,
      },
      { type: "divider" },
      {
        key: "change-password",
        icon: <KeyOutlined />,
        label: t("layout.changePassword"),
        onClick: () => navigate("/change-password"),
      },
      {
        key: "logout",
        icon: <LogoutOutlined />,
        label: <span style={{ color: "#ef4444" }}>{t("layout.logout")}</span>,
        onClick: async () => {
          try { await logoutApi(); } catch { /* ignore */ }
          logout();
          navigate("/login", { replace: true });
        },
      },
    ],
  };

  // ─── User name display ─────────────────────────────────────────────────────
  const displayName = user?.email?.split("@")[0] || "User";

  // ─── Sidebar content ───────────────────────────────────────────────────────
  const sidebarContent = (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", ...sidebarCSSVars }}>
      <BrandLogo
        collapsed={collapsed}
        title={brandTitle}
        subtitle={t("layout.hrPayroll")}
        accent={sidebarBrandTheme.accent}
        accentGlow={sidebarBrandTheme.accentGlow}
        titleColor={sidebarBrandTheme.titleColor}
      />
      <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden", paddingBottom: 8, position: "relative" }}>
        <Menu
          mode="inline"
          theme="dark"
          inlineCollapsed={collapsed}
          selectedKeys={[getSelectedKey(location.pathname, menuItems)]}
          openKeys={openMenuKeys}
          onOpenChange={setOpenMenuKeys}
          items={menuItems}
          className="modern-sidebar"
          style={{
            background: "transparent",
            border: "none",
          }}
        />
      </div>
      {/* Bottom user card */}
      <div
        style={{
          padding: collapsed ? "10px 0" : "10px 12px",
          borderTop: `1px solid ${sbTheme.border}`,
          display: "flex",
          alignItems: "center",
          gap: 10,
          justifyContent: collapsed ? "center" : "flex-start",
          flexShrink: 0,
          transition: "padding 0.25s cubic-bezier(0.4,0,0.2,1)",
        }}
      >
        <Tooltip
          title={collapsed ? `${displayName} · ${getRoleLabel(role)}` : undefined}
          placement="right"
        >
          <Avatar
            size={32}
            icon={<UserOutlined />}
            style={{
              background: `linear-gradient(135deg, ${roleColor(role)}, ${roleColor(role)}88)`,
              fontSize: 13,
              fontWeight: 700,
              flexShrink: 0,
              boxShadow: `0 0 0 2px ${sbTheme.bg}, 0 0 0 4px ${sbTheme.accent}44`,
              cursor: "default",
            }}
          >
            {displayName.charAt(0).toUpperCase()}
          </Avatar>
        </Tooltip>
        {!collapsed && (
          <div style={{ minWidth: 0, overflow: "hidden" }}>
            <div style={{ fontWeight: 600, fontSize: 12.5, color: "rgba(255,255,255,0.82)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {displayName}
            </div>
            <div style={{ fontSize: 11, color: sbTheme.sectionColor, whiteSpace: "nowrap" }}>
              {getRoleLabel(role)}
            </div>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <Layout style={{ minHeight: "100vh", direction }}>

      {/* ── Desktop Sidebar ── */}
      {!isMobile && (
        <Sider
          width={240}
          collapsible
          collapsed={collapsed}
          collapsedWidth={64}
          onCollapse={(value) => {
            setCollapsed(value);
            localStorage.setItem('ffi_sidebar_collapsed', String(value));
          }}
          style={{
            ...sidebarCSSVars,
            background: sbTheme.bg,
            borderInlineEnd: `1px solid ${sbTheme.border}`,
            boxShadow: "none",
            overflow: "hidden",
            position: "sticky",
            top: 0,
            height: "100vh",
            zIndex: 100,
          }}
          className="modern-sidebar"
        >
          {sidebarContent}
        </Sider>
      )}

      {/* ── Mobile Drawer ── */}
      {isMobile && (
        <Drawer
          placement={direction === "rtl" ? "right" : "left"}
          onClose={() => setMobileMenuOpen(false)}
          open={mobileMenuOpen}
          width={260}
          bodyStyle={{ padding: 0, background: sbTheme.bg, ...sidebarCSSVars }}
          styles={{ header: { display: "none" } }}
          className="modern-sidebar"
        >
          {sidebarContent}
        </Drawer>
      )}

      {/* ── Main Content ── */}
      <Layout style={{ background: "var(--surface-1, #f8faff)" }}>

        {/* ── Header ── */}
        <Header
          style={{
            background: "transparent",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: isMobile ? "0 16px" : "0 28px",
            height: 72,
            position: "sticky",
            top: 0,
            zIndex: 50,
          }}
        >
          {/* Left: hamburger + page title */}
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            {isMobile && (
              <Button
                icon={<MenuOutlined />}
                onClick={() => setMobileMenuOpen(true)}
                type="text"
                style={{
                  fontSize: 18,
                  width: 40,
                  height: 40,
                  borderRadius: 10,
                  background: "rgba(249,115,22,0.08)",
                  color: "#f97316",
                }}
              />
            )}
            <Typography.Title
              level={isMobile ? 5 : 4}
              style={{
                margin: 0,
                fontWeight: 600,
                fontSize: isMobile ? 14 : 15,
                color: "#64748b",
                letterSpacing: "0.02em",
                textTransform: "uppercase",
                fontFamily: "'Outfit', sans-serif",
              }}
            >
              {getTitle(location.pathname, t)}
            </Typography.Title>
          </div>

          {/* Right: language selector + user pill */}
          <div
            className="glass"
            style={{
              display: "flex",
              alignItems: "center",
              gap: isMobile ? 8 : 16,
              padding: isMobile ? "6px 10px" : "8px 16px",
              borderRadius: 50,
              background: organizationTheme.shellBg,
              color: organizationTheme.text,
              border: `1px solid ${organizationTheme.shellBorder}`,
              boxShadow: `${organizationTheme.shellShadow}, ${organizationTheme.shellInset}`,
              transition: "background 220ms cubic-bezier(0.22, 1, 0.36, 1), border-color 220ms cubic-bezier(0.22, 1, 0.36, 1), box-shadow 220ms cubic-bezier(0.22, 1, 0.36, 1)",
            }}
          >
            {/* Language Selector */}
            {organizations.length > 0 && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  minWidth: isMobile ? 138 : 220,
                  padding: isMobile ? "4px 8px" : "6px 10px 6px 12px",
                  borderRadius: 18,
                  background: organizationTheme.selectBg,
                  border: `1px solid ${organizationTheme.selectBorder}`,
                  boxShadow: organizationTheme.selectShadow,
                  transition: "all 220ms cubic-bezier(0.22, 1, 0.36, 1)",
                }}
              >
                <div
                  style={{
                    width: 10,
                    height: 10,
                    minWidth: 10,
                    borderRadius: "50%",
                    background: organizationTheme.accent,
                    boxShadow: `0 0 0 6px ${organizationTheme.accentSoft}`,
                  }}
                />
                <Select
                  size="small"
                  value={activeOrganizationId ?? undefined}
                  onChange={handleOrganizationChange}
                  loading={isSwitchingOrganization}
                  disabled={isSwitchingOrganization}
                  variant="borderless"
                  options={organizations.map((org) => ({
                    value: org.id,
                    label: org.node_type === "head_office" ? `${org.name} (Read only)` : org.name,
                  }))}
                  style={{
                    minWidth: isMobile ? 110 : 172,
                    fontWeight: 700,
                    fontSize: 13,
                    color: organizationTheme.text,
                  }}
                />
              </div>
            )}

            <Select
              size="small"
              value={language}
              onChange={(value) => setLanguage(value as AppLanguage)}
              options={[
                { value: "en", label: isMobile ? "EN" : t("language.english") },
                { value: "ar", label: isMobile ? "AR" : t("language.arabic") },
              ]}
              variant="borderless"
              style={{ minWidth: isMobile ? 56 : 90, fontWeight: 600, fontSize: 13, color: organizationTheme.text }}
            />

            {/* Notification Bell */}
            <Badge count={0} showZero={false}>
              <Button
                icon={<BellOutlined />}
                type="text"
                style={{
                  width: isMobile ? 30 : 36,
                  height: isMobile ? 30 : 36,
                  borderRadius: 10,
                  color: organizationTheme.muted,
                  background: organizationTheme.accentSoft,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              />
            </Badge>

            {/* Divider */}
            {!isMobile && <div style={{ width: 1, height: 24, background: organizationTheme.divider }} />}

            {/* User Profile Dropdown */}
            <Dropdown menu={userMenu} placement="bottomRight" trigger={["click"]}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  cursor: "pointer",
                  padding: "4px 0",
                }}
              >
                <Avatar
                  size={34}
                  icon={<UserOutlined />}
                  style={{
                    background: `linear-gradient(135deg, ${roleColor(role)}, ${roleColor(role)}99)`,
                    fontSize: 14,
                    fontWeight: 600,
                    flexShrink: 0,
                    boxShadow: `0 0 0 2px white, 0 0 0 4px ${roleColor(role)}40`,
                  }}
                >
                  {displayName.charAt(0).toUpperCase()}
                </Avatar>
                {!isMobile && (
                  <div style={{ lineHeight: 1.3 }}>
                    <div style={{ fontWeight: 600, fontSize: 13, color: organizationTheme.text }}>
                      {displayName}
                    </div>
                    <div style={{ fontSize: 11, color: organizationTheme.muted }}>{role}</div>
                  </div>
                )}
                <DownOutlined style={{ fontSize: 9, color: organizationTheme.muted }} />
              </div>
            </Dropdown>
          </div>
        </Header>

        {/* ── Page Content ── */}
        <Content
          style={{
            padding: isMobile ? 12 : 24,
            overflowX: "hidden",
          }}
        >
          {isHeadOffice && (
            <div
              style={{
                margin: "0 auto 20px",
                maxWidth: 1600,
                borderRadius: 18,
                border: "1px solid rgba(148, 163, 184, 0.22)",
                background: "linear-gradient(135deg, rgba(255,255,255,0.96), rgba(248,250,252,0.98))",
                boxShadow: "0 12px 28px rgba(15, 23, 42, 0.06)",
                padding: isMobile ? "12px 14px" : "14px 18px",
                display: "flex",
                alignItems: "center",
                gap: 12,
              }}
            >
              <div
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 12,
                  background: "rgba(71, 85, 105, 0.10)",
                  color: "#475569",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                <LockOutlined />
              </div>
              <div>
                <div style={{ fontWeight: 700, color: "#0f172a", fontSize: 14 }}>{t("organization.headOffice.bannerTitle")}</div>
                <div style={{ color: "#64748b", fontSize: 13 }}>
                  {t("organization.headOffice.bannerDescription")}
                </div>
              </div>
            </div>
          )}
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
}
