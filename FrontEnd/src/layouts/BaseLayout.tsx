import { useEffect, useState } from "react";
import { Layout, Menu, Dropdown, Typography, Avatar, Drawer, Grid, Button, Select, Badge } from "antd";
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
} from "@ant-design/icons";
import type { MenuProps } from "antd";
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuthStore } from "../auth/authStore";
import { logoutApi } from "../services/api/authApi";
import { useI18n } from "../i18n/useI18n";
import type { AppLanguage } from "../i18n/types";
import { getEmployee } from "../services/api/employeesApi";
import { isApiError } from "../services/api/apiTypes";
import { isFinanceApproverEmployee } from "../utils/financeApprover";
import { isCFOApproverEmployee } from "../utils/cfoApprover";
import { isCEOApproverEmployee } from "../utils/ceoApprover";

const { Header, Sider, Content } = Layout;
const { useBreakpoint } = Grid;

// ─── Brand Logo ────────────────────────────────────────────────────────────────
type BrandLogoProps = { collapsed?: boolean; subtitle: string };

function BrandLogo({ collapsed, subtitle }: BrandLogoProps) {
  return (
    <div
      style={{
        padding: collapsed ? "20px 0" : "20px 20px",
        display: "flex",
        alignItems: "center",
        justifyContent: collapsed ? "center" : "flex-start",
        gap: collapsed ? 0 : 12,
        transition: "all 0.3s cubic-bezier(0.4,0,0.2,1)",
        borderBottom: "1px solid rgba(255,255,255,0.06)",
        marginBottom: 8,
      }}
    >
      {/* Logo icon */}
      <div
        style={{
          width: 38,
          height: 38,
          background: "linear-gradient(135deg, #f97316, #fb923c)",
          borderRadius: 10,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "white",
          fontWeight: 700,
          fontSize: 16,
          flexShrink: 0,
          boxShadow: "0 4px 14px rgba(249,115,22,0.5)",
        }}
      >
        <ApartmentOutlined />
      </div>

      {!collapsed && (
        <div style={{ overflow: "hidden" }}>
          <div
            style={{
              fontWeight: 800,
              fontSize: 16,
              color: "white",
              letterSpacing: "-0.02em",
              lineHeight: 1.2,
              fontFamily: "'Outfit', 'Inter', sans-serif",
            }}
          >
            FFISYS
          </div>
          <div style={{ fontSize: 11, color: "rgba(251,146,60,0.8)", marginTop: 1 }}>
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
  if (pathname.startsWith("/admin/settings")) return t("layout.systemSettings");
  if (pathname.startsWith("/hr/dashboard")) return t("layout.dashboardOverview");
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
  if (pathname.startsWith("/ceo/announcements")) return t("layout.announcements", "Announcements");
  if (pathname.startsWith("/ceo/profile")) return t("layout.profile");
  if (pathname.startsWith("/hr/loan-requests")) return t("layout.loanRequests", "Loan Requests");
  if (pathname.startsWith("/hr/assets")) return t("layout.assets", "Assets");
  if (pathname.startsWith("/hr/rents")) return t("layout.rents", "Rents");
  if (pathname.startsWith("/hr/rent-types")) return t("layout.rentTypes", "Rent Types");
  if (pathname.startsWith("/finance/loan-requests")) return t("layout.loanRequests", "Loan Requests");
  if (pathname.startsWith("/manager/loan-requests")) return t("layout.loanRequests", "Loan Requests");
  if (pathname.startsWith("/cfo/loan-requests")) return t("layout.loanRequests", "Loan Requests");
  if (pathname.startsWith("/cfo/profile")) return t("layout.profile");
  if (pathname.startsWith("/employee/loans")) return t("layout.loanRequests", "Loan Requests");
  if (pathname.startsWith("/employee/assets")) return t("layout.myAssets", "My Assets");
  if (pathname.startsWith("/employee")) return t("layout.employeeSelfService");
  if (pathname.startsWith("/change-password")) return t("layout.changePassword");
  return t("app.title");
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

// ─── Main Layout ────────────────────────────────────────────────────────────────
export default function BaseLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const { t, language, setLanguage, direction } = useI18n();

  const screens = useBreakpoint();
  const isMobile = !screens.md;

  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [isFinanceApprover, setIsFinanceApprover] = useState(false);
  const [isCFOApprover, setIsCFOApprover] = useState(false);
  const [isCEOApprover, setIsCEOApprover] = useState(false);

  const role = user?.role;

  useEffect(() => {
    let mounted = true;
    async function loadFinanceEligibility() {
      if (role !== "Employee") {
        if (mounted) {
          setIsFinanceApprover(false);
          setIsCFOApprover(false);
          setIsCEOApprover(false);
        }
        return;
      }
      try {
        const res = await getEmployee("me");
        if (!mounted) return;
        if (isApiError(res)) {
          setIsFinanceApprover(false);
          setIsCFOApprover(false);
          setIsCEOApprover(false);
        } else {
          setIsFinanceApprover(isFinanceApproverEmployee(res.data));
          setIsCFOApprover(isCFOApproverEmployee(res.data));
          setIsCEOApprover(isCEOApproverEmployee(res.data));
        }
      } catch {
        if (mounted) {
          setIsFinanceApprover(false);
          setIsCFOApprover(false);
          setIsCEOApprover(false);
        }
      }
    }
    loadFinanceEligibility();
    return () => { mounted = false; };
  }, [role]);

  // ─── Menu definitions ──────────────────────────────────────────────────────
  const adminItems: MenuProps["items"] = [
    { key: "/admin/dashboard", icon: <DashboardOutlined />, label: <Link to="/admin/dashboard">{t("layout.dashboard")}</Link> },
    { key: "/admin/users", icon: <TeamOutlined />, label: <Link to="/admin/users">{t("layout.users")}</Link> },
    { key: "/admin/users/create", icon: <UserAddOutlined />, label: <Link to="/admin/users/create">{t("layout.createUser")}</Link> },
    { key: "/admin/invites", icon: <UserAddOutlined />, label: <Link to="/admin/invites">{t("layout.invites")}</Link> },
    { key: "/admin/audit-logs", icon: <FileSearchOutlined />, label: <Link to="/admin/audit-logs">{t("layout.auditLogs")}</Link> },
    { key: "/admin/settings", icon: <SettingOutlined />, label: <Link to="/admin/settings">{t("layout.settings")}</Link> },
    { key: "/admin/profile", icon: <IdcardOutlined />, label: <Link to="/admin/profile">{t("layout.profile")}</Link> },
  ];

  const hrItems: MenuProps["items"] = [
    { key: "/hr/dashboard", icon: <DashboardOutlined />, label: <Link to="/hr/dashboard">{t("layout.dashboard")}</Link> },
    { key: "/hr/employees", icon: <TeamOutlined />, label: <Link to="/hr/employees">{t("layout.employees")}</Link> },
    { key: "/hr/departments", icon: <ApartmentOutlined />, label: <Link to="/hr/departments">{t("layout.departments")}</Link> },
    { key: "/hr/positions", icon: <IdcardOutlined />, label: <Link to="/hr/positions">{t("layout.positions")}</Link> },
    { key: "/hr/task-groups", icon: <GroupOutlined />, label: <Link to="/hr/task-groups">{t("layout.taskGroups")}</Link> },
    { key: "/hr/sponsors", icon: <SafetyOutlined />, label: <Link to="/hr/sponsors">{t("layout.sponsors")}</Link> },
    { type: "divider" },
    { key: "/hr/import/employees", icon: <UploadOutlined />, label: <Link to="/hr/import/employees">{t("layout.importEmployees")}</Link> },
    { key: "/hr/payroll", icon: <DollarOutlined />, label: <Link to="/hr/payroll">{t("layout.payroll")}</Link> },
    { key: "/hr/assets", icon: <AppstoreOutlined />, label: <Link to="/hr/assets">{t("layout.assets", "Assets")}</Link> },
    { key: "/hr/rents", icon: <BellOutlined />, label: <Link to="/hr/rents">{t("layout.rents", "Rents")}</Link> },
    { key: "/hr/rent-types", icon: <SettingOutlined />, label: <Link to="/hr/rent-types">{t("layout.rentTypes", "Rent Types")}</Link> },
    { key: "/hr/leave/requests", icon: <CalendarOutlined />, label: <Link to="/hr/leave/requests">{t("layout.leaveInbox")}</Link> },
    { key: "/hr/loan-requests", icon: <DollarOutlined />, label: <Link to="/hr/loan-requests">{t("layout.loanRequests", "Loan Requests")}</Link> },
    { key: "/hr/attendance", icon: <ClockCircleOutlined />, label: <Link to="/hr/attendance">{t("layout.attendance")}</Link> },
    { key: "/hr/profile", icon: <IdcardOutlined />, label: <Link to="/hr/profile">{t("layout.profile")}</Link> },
  ];

  const employeeItems: MenuProps["items"] = [
    { key: "/employee/home", icon: <DashboardOutlined />, label: <Link to="/employee/home">{t("layout.home")}</Link> },
    { key: "/employee/attendance", icon: <CalendarOutlined />, label: <Link to="/employee/attendance">{t("layout.attendance")}</Link> },
    { key: "/employee/leave/balance", icon: <FileSearchOutlined />, label: <Link to="/employee/leave/balance">{t("layout.leaveBalance")}</Link> },
    { key: "/employee/leave/requests", icon: <CalendarOutlined />, label: <Link to="/employee/leave/requests">{t("layout.myRequests")}</Link> },
    ...(isFinanceApprover
      ? [{ key: "/finance/loan-requests", icon: <DollarOutlined />, label: <Link to="/finance/loan-requests">{t("layout.loanInbox", "Loan Inbox")}</Link> }]
      : []),
    { key: "/employee/assets", icon: <AppstoreOutlined />, label: <Link to="/employee/assets">{t("layout.myAssets", "My Assets")}</Link> },
    { key: "/employee/loans", icon: <DollarOutlined />, label: <Link to="/employee/loans">{t("layout.loanRequests", "Loan Requests")}</Link> },
    { key: "/employee/payslips", icon: <DollarOutlined />, label: <Link to="/employee/payslips">{t("layout.myPayslips")}</Link> },
  ];

  const managerItems: MenuProps["items"] = [
    { key: "/manager/dashboard", icon: <DashboardOutlined />, label: <Link to="/manager/dashboard">{t("layout.dashboard")}</Link> },
    { key: "/manager/team-requests", icon: <FileSearchOutlined />, label: <Link to="/manager/team-requests">{t("layout.teamRequests", "Team Requests")}</Link> },
    { key: "/manager/loan-requests", icon: <DollarOutlined />, label: <Link to="/manager/loan-requests">{t("layout.loanRequests", "Loan Requests")}</Link> },
    { key: "/manager/team", icon: <TeamOutlined />, label: <Link to="/manager/team">{t("layout.myTeam", "My Team")}</Link> },
    { type: "divider" },
    { key: "/employee/attendance", icon: <ClockCircleOutlined />, label: <Link to="/employee/attendance">{t("layout.attendance")}</Link> },
    { key: "/employee/assets", icon: <AppstoreOutlined />, label: <Link to="/employee/assets">{t("layout.myAssets", "My Assets")}</Link> },
    { key: "/employee/leave/request", icon: <CalendarOutlined />, label: <Link to="/employee/leave/request">{t("layout.requestLeave", "Request Leave")}</Link> },
    { key: "/employee/leave/requests", icon: <FileSearchOutlined />, label: <Link to="/employee/leave/requests">{t("layout.myRequests")}</Link> },
    { key: "/manager/announcements", icon: <BellOutlined />, label: <Link to="/manager/announcements">{t("layout.announcements", "Announcements")}</Link> },
    { key: "/manager/announcements/create", icon: <UserAddOutlined />, label: <Link to="/manager/announcements/create">{t("layout.createAnnouncement", "Create Announcement")}</Link> },
    { key: "/manager/profile", icon: <IdcardOutlined />, label: <Link to="/manager/profile">{t("layout.profile")}</Link> },
  ];

  const ceoItems: MenuProps["items"] = [
    { key: "/ceo/leave/requests", icon: <CalendarOutlined />, label: <Link to="/ceo/leave/requests">{t("layout.ceoLeaveApprovals", "Leave Approvals")}</Link> },
    { key: "/ceo/team-requests", icon: <FileSearchOutlined />, label: <Link to="/ceo/team-requests">{t("layout.teamRequests", "Team Requests")}</Link> },
    { key: "/ceo/team", icon: <TeamOutlined />, label: <Link to="/ceo/team">{t("layout.ceoTeam", "Leadership Team")}</Link> },
    { key: "/ceo/loan-requests", icon: <DollarOutlined />, label: <Link to="/ceo/loan-requests">{t("layout.loanRequests", "Loan Requests")}</Link> },
    { key: "/ceo/announcements", icon: <BellOutlined />, label: <Link to="/ceo/announcements">{t("layout.announcements", "Announcements")}</Link> },
    { key: "/ceo/announcements/create", icon: <UserAddOutlined />, label: <Link to="/ceo/announcements/create">{t("layout.createAnnouncement", "Create Announcement")}</Link> },
    { key: "/ceo/profile", icon: <IdcardOutlined />, label: <Link to="/ceo/profile">{t("layout.profile")}</Link> },
  ];

  const cfoItems: MenuProps["items"] = [
    { key: "/cfo/loan-requests", icon: <DollarOutlined />, label: <Link to="/cfo/loan-requests">{t("layout.loanRequests", "Loan Requests")}</Link> },
    { key: "/cfo/profile", icon: <IdcardOutlined />, label: <Link to="/cfo/profile">{t("layout.profile")}</Link> },
  ];

  const menuItems =
    role === "SystemAdmin" ? adminItems
      : role === "HRManager" ? hrItems
        : role === "Manager" ? managerItems
          : role === "CEO" ? ceoItems
            : role === "CFO" ? cfoItems
              : role === "Employee"
                ? [
                  ...employeeItems,
                  ...(isCFOApprover ? [{ key: "/cfo/loan-requests", icon: <DollarOutlined />, label: <Link to="/cfo/loan-requests">{t("layout.cfoLoanInbox", "CFO Loan Inbox")}</Link> }] : []),
                  ...(isCEOApprover ? [{ key: "/ceo/loan-requests", icon: <DollarOutlined />, label: <Link to="/ceo/loan-requests">{t("layout.loanRequests", "Loan Requests")}</Link> }] : []),
                ]
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

  // ─── Sidebar content ───────────────────────────────────────────────────────
  const sidebarContent = (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <BrandLogo collapsed={collapsed} subtitle={t("layout.hrPayroll")} />
      <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden", paddingBottom: 16 }}>
        <Menu
          mode="inline"
          theme="dark"
          selectedKeys={[getSelectedKey(location.pathname, menuItems)]}
          items={menuItems}
          className="modern-sidebar"
          style={{
            background: "transparent",
            border: "none",
          }}
        />
      </div>
    </div>
  );

  // ─── User name display ─────────────────────────────────────────────────────
  const displayName = user?.email?.split("@")[0] || "User";

  return (
    <Layout style={{ minHeight: "100vh", direction }}>

      {/* ── Desktop Sidebar ── */}
      {!isMobile && (
        <Sider
          width={240}
          collapsible
          collapsed={collapsed}
          onCollapse={(value) => setCollapsed(value)}
          style={{
            background: "linear-gradient(180deg, #1a1a1a 0%, #2d2d2d 100%)",
            boxShadow: "4px 0 24px rgba(0,0,0,0.3)",
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
          bodyStyle={{ padding: 0, background: "linear-gradient(180deg, #1a1a1a 0%, #2d2d2d 100%)" }}
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
              boxShadow: "0 2px 20px rgba(0,0,0,0.06)",
            }}
          >
            {/* Language Selector */}
            <Select
              size="small"
              value={language}
              onChange={(value) => setLanguage(value as AppLanguage)}
              options={[
                { value: "en", label: isMobile ? "EN" : t("language.english") },
                { value: "ar", label: isMobile ? "AR" : t("language.arabic") },
              ]}
              variant="borderless"
              style={{ minWidth: isMobile ? 56 : 90, fontWeight: 500, fontSize: 13 }}
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
                  color: "#64748b",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              />
            </Badge>

            {/* Divider */}
            {!isMobile && <div style={{ width: 1, height: 24, background: "rgba(0,0,0,0.08)" }} />}

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
                    <div style={{ fontWeight: 600, fontSize: 13, color: "#0f172a" }}>
                      {displayName}
                    </div>
                    <div style={{ fontSize: 11, color: "#94a3b8" }}>{role}</div>
                  </div>
                )}
                <DownOutlined style={{ fontSize: 9, color: "#94a3b8" }} />
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
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
}
