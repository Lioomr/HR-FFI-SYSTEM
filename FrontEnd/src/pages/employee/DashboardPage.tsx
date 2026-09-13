import { useEffect, useState } from "react";
import { Alert, Button, Empty, Input, Skeleton } from "antd";
import {
  ArrowRightOutlined,
  CalendarOutlined,
  ClockCircleOutlined,
  FileTextOutlined,
  SearchOutlined,
  UserOutlined,
  WalletOutlined,
  InboxOutlined,
  CheckSquareOutlined,
  PlusOutlined,
} from "@ant-design/icons";
import { Link } from "react-router-dom";
import { getEmployee, type Employee } from "../../services/api/employeesApi";
import AnnouncementWidget from "../../components/announcements/AnnouncementWidget";
import { useI18n } from "../../i18n/useI18n";
import "./dashboard.css";
import CurrentRequests from "./CurrentRequests";

export default function DashboardPage() {
  const { t, language } = useI18n();
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [search, setSearch] = useState("");

  useEffect(() => {
    let active = true;
    getEmployee("me")
      .then((res) => {
        if (!active) return;
        if (res.status === "success") setEmployee(res.data);
        else setFailed(true);
      })
      .catch(() => {
        if (active) setFailed(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [attempt]);

  const label = (key: string) => t(`employee.dashboard.${key}`);
  const requests = [
    {
      key: "leave",
      icon: <CalendarOutlined />,
      title: label("myLeaves"),
      description: label("leaveHint"),
      create: "/employee/leave/request",
      track: "/employee/leave/requests",
    },
    {
      key: "permission",
      icon: <ClockCircleOutlined />,
      title: label("permissionTitle"),
      description: label("permissionDesc"),
      create: "/employee/permission-requests/new",
      track: "/employee/permission-requests",
    },
    {
      key: "loan",
      icon: <WalletOutlined />,
      title: label("loans"),
      description: label("loanHint"),
      create: "/employee/loans/request",
      track: "/employee/loans",
    },
  ];
  const services = [
    {
      title: label("attendance"),
      description: label("attendanceHint"),
      icon: <ClockCircleOutlined />,
      path: "/employee/attendance",
    },
    {
      title: label("balance"),
      description: label("balanceHint"),
      icon: <CalendarOutlined />,
      path: "/employee/leave/balance",
    },
    {
      title: label("myPayslips"),
      description: label("myPayslipsDesc"),
      icon: <WalletOutlined />,
      path: "/employee/payslips",
    },
    {
      title: label("corrections"),
      description: label("correctionsHint"),
      icon: <FileTextOutlined />,
      path: "/employee/attendance-corrections",
    },
    {
      title: label("assets"),
      description: label("assetsHint"),
      icon: <InboxOutlined />,
      path: "/employee/assets",
    },
    {
      title: label("myProfile"),
      description: label("myProfileDesc"),
      icon: <UserOutlined />,
      path: "/employee/profile",
    },
    {
      title: label("delegated"),
      description: label("delegatedHint"),
      icon: <CheckSquareOutlined />,
      path: "/employee/delegated-approvals",
    },
  ];
  const query = search.trim().toLocaleLowerCase(language);
  const visibleServices = services.filter(({ title, description }) =>
    `${title} ${description}`.toLocaleLowerCase(language).includes(query),
  );
  const displayName =
    language === "ar"
      ? employee?.full_name_ar || employee?.full_name_en || employee?.full_name
      : employee?.full_name_en || employee?.full_name || employee?.full_name_ar;

  return (
    <div className="employee-dashboard" dir={language === "ar" ? "rtl" : "ltr"}>
      <header className="ed-welcome">
        <div>
          <span className="ed-eyebrow">{label("subtitle")}</span>
          <h1>
            {label("welcome")}
            {displayName
              ? `${language === "ar" ? "،" : ","} ${displayName}`
              : ""}
          </h1>
          <p>{label("intro")}</p>
        </div>
        <Link className="ed-profile-link" to="/employee/profile">
          <UserOutlined />
          {label("viewProfile")}
          <ArrowRightOutlined className="ed-arrow" />
        </Link>
      </header>
      {loading && <Skeleton active title={false} paragraph={{ rows: 1 }} />}
      {failed && (
        <Alert
          type="warning"
          showIcon
          title={label("profileError")}
          action={
            <Button
              size="small"
              onClick={() => {
                setFailed(false);
                setLoading(true);
                setAttempt((value) => value + 1);
              }}
            >
              {label("retry")}
            </Button>
          }
        />
      )}
      <CurrentRequests />
      <section className="ed-requests" aria-labelledby="ed-request-title">
        <div className="ed-section-heading">
          <div>
            <span className="ed-eyebrow">{label("selfService")}</span>
            <h2 id="ed-request-title">{label("requestsTitle")}</h2>
            <p>{label("requestsHint")}</p>
          </div>
        </div>
        <div className="ed-request-grid">
          {requests.map((request) => (
            <article
              className={`ed-request-card ed-${request.key}`}
              key={request.key}
            >
              <span className="ed-icon">{request.icon}</span>
              <h3>{request.title}</h3>
              <p>{request.description}</p>
              <Link
                className="ed-create"
                to={request.create}
                aria-label={`${label("newRequest")}: ${request.title}`}
              >
                <PlusOutlined />
                {label("newRequest")}
              </Link>
              <Link
                className="ed-track"
                to={request.track}
                aria-label={`${label("trackRequests")}: ${request.title}`}
              >
                {label("trackRequests")}
                <ArrowRightOutlined className="ed-arrow" />
              </Link>
            </article>
          ))}
        </div>
      </section>
      <div className="ed-bottom-grid">
        <section className="ed-services" aria-labelledby="ed-service-title">
          <div className="ed-section-heading">
            <div>
              <h2 id="ed-service-title">{label("servicesTitle")}</h2>
              <p>{label("servicesHint")}</p>
            </div>
          </div>
          <Input
            size="large"
            prefix={<SearchOutlined />}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            allowClear
            placeholder={label("searchServices")}
            aria-label={label("searchServices")}
          />
          <div className="ed-service-list">
            {visibleServices.map((service) => (
              <Link className="ed-service" to={service.path} key={service.path}>
                <span className="ed-service-icon">{service.icon}</span>
                <span>
                  <strong>{service.title}</strong>
                  <span className="ed-service-description">
                    {service.description}
                  </span>
                </span>
                <ArrowRightOutlined className="ed-arrow" />
              </Link>
            ))}
          </div>
          {!visibleServices.length && (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={label("noServices")}
            >
              <Button onClick={() => setSearch("")}>
                {label("clearSearch")}
              </Button>
            </Empty>
          )}
        </section>
        <aside className="ed-announcements">
          <AnnouncementWidget role="employee" />
        </aside>
      </div>
    </div>
  );
}
