import { useState, useEffect } from "react";
import { Layout, Menu, Dropdown, Typography, Avatar, Drawer, Grid, Button } from "antd";
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
  ClockCircleOutlined
} from "@ant-design/icons";
import type { MenuProps } from "antd";
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuthStore } from "../auth/authStore";
import { logoutApi } from "../services/api/authApi";

const { Header, Sider, Content } = Layout;
const { useBreakpoint } = Grid;

// Helper to find the longest menu key that matches the current pathname
function getSelectedKey(pathname: string, items: MenuProps["items"]): string {
  if (!items) return pathname;

  let longestMatch = pathname;
  let longestMatchLength = 0;

  const checkItems = (menuItems: MenuProps["items"]) => {
    menuItems?.forEach((item: any) => {
      if (item && item.key && typeof item.key === "string") {
        // Check if pathname starts with this menu key
        if (pathname.startsWith(item.key) && item.key.length > longestMatchLength) {
          longestMatch = item.key;
          longestMatchLength = item.key.length;
        }
      }
    });
  };

  checkItems(items);
  return longestMatch;
}

function getTitle(pathname: string) {
  if (pathname.startsWith("/admin/dashboard")) return "Admin Dashboard";
  if (pathname.startsWith("/admin/users/create")) return "Create User";
  if (pathname.startsWith("/admin/users")) return "User Management";
  if (pathname.startsWith("/admin/invites")) return "Invites";
  if (pathname.startsWith("/admin/audit-logs")) return "Audit Logs";
  if (pathname.startsWith("/admin/settings")) return "System Settings";
  if (pathname.startsWith("/hr/dashboard")) return "Dashboard Overview";
  if (pathname.startsWith("/hr")) return "HR Management";
  if (pathname.startsWith("/employee")) return "Employee Self-Service";
  if (pathname.startsWith("/change-password")) return "Change Password";
  return "FFI HR System";
}

export default function BaseLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);

  const screens = useBreakpoint();
  // Assume desktop if screens.md is true, otherwise mobile
  // Note: on first render screens might be empty object, so default to safe
  const isMobile = !screens.md;

  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const role = user?.role;

  const adminItems: MenuProps["items"] = [
    { key: "/admin/dashboard", icon: <DashboardOutlined />, label: <Link to="/admin/dashboard">Dashboard</Link> },
    { key: "/admin/users", icon: <TeamOutlined />, label: <Link to="/admin/users">Users</Link> },
    { key: "/admin/users/create", icon: <UserAddOutlined />, label: <Link to="/admin/users/create">Create User</Link> },
    { key: "/admin/invites", icon: <UserAddOutlined />, label: <Link to="/admin/invites">Invites</Link> },
    { key: "/admin/audit-logs", icon: <FileSearchOutlined />, label: <Link to="/admin/audit-logs">Audit Logs</Link> },
    { key: "/admin/settings", icon: <SettingOutlined />, label: <Link to="/admin/settings">Settings</Link> },
    { key: "/admin/profile", icon: <IdcardOutlined />, label: <Link to="/admin/profile">Profile</Link> },
  ];

  const hrItems: MenuProps["items"] = [
    { key: "/hr/dashboard", icon: <DashboardOutlined />, label: <Link to="/hr/dashboard">Dashboard</Link> },
    { key: "/hr/employees", icon: <TeamOutlined />, label: <Link to="/hr/employees">Employees</Link> },
    { key: "/hr/departments", icon: <ApartmentOutlined />, label: <Link to="/hr/departments">Departments</Link> },
    { key: "/hr/positions", icon: <IdcardOutlined />, label: <Link to="/hr/positions">Positions</Link> },
    { key: "/hr/task-groups", icon: <GroupOutlined />, label: <Link to="/hr/task-groups">Task Groups</Link> },
    { key: "/hr/sponsors", icon: <SafetyOutlined />, label: <Link to="/hr/sponsors">Sponsors</Link> },
    { type: "divider" },
    { key: "/hr/import/employees", icon: <UploadOutlined />, label: <Link to="/hr/import/employees">Import Employees</Link> },
    { key: "/hr/payroll", icon: <DollarOutlined />, label: <Link to="/hr/payroll">Payroll</Link> },
    { key: "/hr/leave/requests", icon: <CalendarOutlined />, label: <Link to="/hr/leave/requests">Leave Inbox</Link> },
    { key: "/hr/attendance", icon: <ClockCircleOutlined />, label: <Link to="/hr/attendance">Attendance</Link> },
    { key: "/hr/profile", icon: <IdcardOutlined />, label: <Link to="/hr/profile">Profile</Link> },
  ];

  const employeeItems: MenuProps["items"] = [
    { key: "/employee/home", icon: <DashboardOutlined />, label: <Link to="/employee/home">Home</Link> },
    { key: "/employee/attendance", icon: <CalendarOutlined />, label: <Link to="/employee/attendance">Attendance</Link> },
    { key: "/employee/leave/balance", icon: <FileSearchOutlined />, label: <Link to="/employee/leave/balance">Leave Balance</Link> },
    { key: "/employee/leave/requests", icon: <CalendarOutlined />, label: <Link to="/employee/leave/requests">My Requests</Link> },
    // { key: "/employee/leaves", icon: <FileSearchOutlined />, label: <Link to="/employee/leaves">My Leaves</Link> }, // Deprecated/Replaced
    { key: "/employee/payslips", icon: <DollarOutlined />, label: <Link to="/employee/payslips">My Payslips</Link> },

  ];

  const menuItems =
    role === "SystemAdmin" ? adminItems : role === "HRManager" ? hrItems : role === "Employee" ? employeeItems : [];

  const userMenu: MenuProps = {
    items: [
      {
        key: "change-password",
        icon: <KeyOutlined />,
        label: "Change Password",
        onClick: () => navigate("/change-password"),
      },
      {
        key: "logout",
        icon: <LogoutOutlined />,
        label: "Logout",
        onClick: async () => {
          try { await logoutApi(); } catch { }
          logout();
          navigate("/login", { replace: true });
        }
      },
    ],
  };

  // Common Logo/Branding Component
  const BrandLogo = () => (
    <div style={{ padding: '24px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
      <div style={{ width: 32, height: 32, background: '#ff7a45', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 'bold' }}>
        <ApartmentOutlined />
      </div>
      <div>
        <Typography.Title level={5} style={{ margin: 0, fontSize: 16 }}>
          FFISYS Admin
        </Typography.Title>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          HR & Payroll
        </Typography.Text>
      </div>
    </div>
  );

  return (
    <Layout style={{ minHeight: "100vh" }}>

      {/* Desktop Sidebar */}
      {!isMobile && (
        <Sider width={240} collapsible theme="light" style={{ boxShadow: '2px 0 8px 0 rgba(29,35,41,.05)' }}>
          <BrandLogo />
          <Menu
            mode="inline"
            selectedKeys={[getSelectedKey(location.pathname, menuItems)]}
            items={menuItems}
            style={{ borderRight: 0 }}
          />
        </Sider>
      )}

      {/* Mobile Drawer */}
      {isMobile && (
        <Drawer
          placement="left"
          onClose={() => setMobileMenuOpen(false)}
          open={mobileMenuOpen}
          width={250}
          bodyStyle={{ padding: 0 }}
          styles={{ header: { display: 'none' } }}
        >
          <BrandLogo />
          <Menu
            mode="inline"
            selectedKeys={[getSelectedKey(location.pathname, menuItems)]}
            items={menuItems}
            style={{ borderRight: 0 }}
            onClick={() => setMobileMenuOpen(false)} // Close drawer on click
          />
        </Drawer>
      )}

      <Layout style={{ background: '#f4f7fe' }}>
        <Header
          style={{
            background: "none",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: isMobile ? "0 16px" : "0 24px",
            height: 80
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            {/* Mobile Hamburger Trigger */}
            {isMobile && (
              <Button
                icon={<MenuOutlined />}
                onClick={() => setMobileMenuOpen(true)}
                type="text"
                style={{ fontSize: '18px' }}
              />
            )}

            {/* Page Title (Smaller on mobile) */}
            <Typography.Title level={isMobile ? 4 : 3} style={{ margin: 0, fontWeight: 700 }}>
              {getTitle(location.pathname)}
            </Typography.Title>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 24, background: 'white', padding: '10px 20px', borderRadius: 30, boxShadow: '0px 2px 20px rgba(0,0,0,0.02)' }}>
            {/* User Profile */}
            <Dropdown menu={userMenu} placement="bottomRight" trigger={["click"]}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }}>
                <Avatar src="https://randomuser.me/api/portraits/men/75.jpg" />
                {!isMobile && (
                  <div style={{ lineHeight: 1.2 }}>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{user?.email?.split('@')[0] || "Alex Morgan"}</div>
                    <div style={{ fontSize: 11, color: '#8c8c8c' }}>{role}</div>
                  </div>
                )}
                <DownOutlined style={{ fontSize: 10, color: '#bfbfbf' }} />
              </div>
            </Dropdown>
          </div>
        </Header>

        <Content style={{ padding: isMobile ? 12 : 24, overflowX: 'hidden' }}>
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
}
