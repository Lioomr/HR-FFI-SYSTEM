import { Layout, Menu, Dropdown, Button, Typography } from "antd";
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
} from "@ant-design/icons";
import type { MenuProps } from "antd";
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuthStore } from "../auth/authStore";
import { logoutApi } from "../services/api/authApi";

const { Header, Sider, Content } = Layout;

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


  const role = user?.role;

  const adminItems: MenuProps["items"] = [
    { key: "/admin/dashboard", icon: <DashboardOutlined />, label: <Link to="/admin/dashboard">Dashboard</Link> },
    { key: "/admin/users", icon: <TeamOutlined />, label: <Link to="/admin/users">Users</Link> },
    { key: "/admin/users/create", icon: <UserAddOutlined />, label: <Link to="/admin/users/create">Create User</Link> },
    { key: "/admin/invites", icon: <UserAddOutlined />, label: <Link to="/admin/invites">Invites</Link> },
    { key: "/admin/audit-logs", icon: <FileSearchOutlined />, label: <Link to="/admin/audit-logs">Audit Logs</Link> },
    { key: "/admin/settings", icon: <SettingOutlined />, label: <Link to="/admin/settings">Settings</Link> },
    { type: "divider" },
    { key: "/hr/attendance", icon: <CalendarOutlined />, label: <Link to="/hr/attendance">HR Attendance</Link> },
    { key: "/hr/leave-balances", icon: <FileSearchOutlined />, label: <Link to="/hr/leave-balances">Leave Balances</Link> },
    { key: "/employee/leaves", icon: <FileSearchOutlined />, label: <Link to="/employee/leaves">My Leaves</Link> },
  ];

  const hrItems: MenuProps["items"] = [
    { key: "/hr/employees", icon: <TeamOutlined />, label: <Link to="/hr/employees">Employees</Link> },
    { key: "/hr/departments", icon: <ApartmentOutlined />, label: <Link to="/hr/departments">Departments</Link> },
    { key: "/hr/positions", icon: <IdcardOutlined />, label: <Link to="/hr/positions">Positions</Link> },
    { key: "/hr/task-groups", icon: <GroupOutlined />, label: <Link to="/hr/task-groups">Task Groups</Link> },
    { key: "/hr/sponsors", icon: <SafetyOutlined />, label: <Link to="/hr/sponsors">Sponsors</Link> },
    { key: "/hr/dashboard", icon: <DashboardOutlined />, label: <Link to="/hr/dashboard">HR Dashboard</Link> },
  ];

  const employeeItems: MenuProps["items"] = [
    { key: "/employee/attendance", icon: <CalendarOutlined />, label: <Link to="/employee/attendance">Attendance</Link> },
    { key: "/employee/leaves", icon: <FileSearchOutlined />, label: <Link to="/employee/leaves">My Leaves</Link> },
    { key: "/employee/home", icon: <DashboardOutlined />, label: <Link to="/employee/home">Home</Link> },
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

  return (
    <Layout style={{ minHeight: "100vh" }}>
      <Sider width={240} collapsible theme="light">
        <div style={{ padding: 16 }}>
          <Typography.Title level={5} style={{ margin: 0 }}>
            FFI HR System
          </Typography.Title>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {role ?? "No role"}
          </Typography.Text>
        </div>

        <Menu
          mode="inline"
          selectedKeys={[getSelectedKey(location.pathname, menuItems)]}
          items={menuItems}
          style={{ borderRight: 0 }}
        />
      </Sider>

      <Layout>
        <Header
          style={{
            background: "transparent",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "0 16px",
          }}
        >
          <Typography.Title level={4} style={{ margin: 0 }}>
            {getTitle(location.pathname)}
          </Typography.Title>

          <Dropdown menu={userMenu} placement="bottomRight" trigger={["click"]}>
            <Button type="primary">
              {user?.email ?? "User"}
            </Button>
          </Dropdown>
        </Header>

        <Content style={{ padding: 16 }}>
          <div style={{ padding: 16, borderRadius: 12, background: "#ffffff" }}>
            <Outlet />
          </div>
        </Content>
      </Layout>
    </Layout>
  );
}
