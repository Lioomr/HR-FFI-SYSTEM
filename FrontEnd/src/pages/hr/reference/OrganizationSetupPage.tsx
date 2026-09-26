import { Tabs } from "antd";
import {
  ApartmentOutlined,
  IdcardOutlined,
  SafetyCertificateOutlined,
  TeamOutlined,
} from "@ant-design/icons";
import { useSearchParams } from "react-router-dom";

import PageHeader from "../../../components/ui/PageHeader";
import { useI18n } from "../../../i18n/useI18n";
import DepartmentsPage from "./DepartmentsPage";
import PositionsPage from "./PositionsPage";
import TaskGroupsPage from "./TaskGroupsPage";
import SponsorsPage from "./SponsorsPage";

const sections = [
  "departments",
  "positions",
  "task-groups",
  "sponsors",
] as const;
type Section = (typeof sections)[number];

function isSection(value: string | null): value is Section {
  return sections.some((section) => section === value);
}

export default function OrganizationSetupPage() {
  const { t } = useI18n();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedSection = searchParams.get("tab");
  const activeSection = isSection(requestedSection)
    ? requestedSection
    : "departments";

  return (
    <div className="org-setup">
      <PageHeader
        title={t("layout.organizationSetup")}
        subtitle={t("reference.setup.subtitle")}
      />
      <Tabs
        className="ffi-pill-tabs"
        activeKey={activeSection}
        onChange={(section) => {
          setSearchParams((params) => {
            const next = new URLSearchParams(params);
            next.set("tab", section);
            return next;
          });
        }}
        destroyOnHidden
        items={[
          {
            key: "departments",
            icon: <ApartmentOutlined aria-hidden="true" />,
            label: t("reference.departments.title"),
            children: <DepartmentsPage />,
          },
          {
            key: "positions",
            icon: <IdcardOutlined aria-hidden="true" />,
            label: t("reference.positions.title"),
            children: <PositionsPage />,
          },
          {
            key: "task-groups",
            icon: <TeamOutlined aria-hidden="true" />,
            label: t("reference.taskGroups.title"),
            children: <TaskGroupsPage />,
          },
          {
            key: "sponsors",
            icon: <SafetyCertificateOutlined aria-hidden="true" />,
            label: t("reference.sponsors.title"),
            children: <SponsorsPage />,
          },
        ]}
      />
    </div>
  );
}
