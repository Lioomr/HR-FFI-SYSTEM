import { useEffect, useState } from "react";
import { Table, notification } from "antd";
import PageHeader from "../../components/ui/PageHeader";
import { getManagerTeam, type ManagerTeamMember } from "../../services/api/managerApi";
import { isApiError } from "../../services/api/apiTypes";
import { useI18n } from "../../i18n/useI18n";

export default function ManagerTeamPage() {
  const { t } = useI18n();
  const [data, setData] = useState<ManagerTeamMember[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const res = await getManagerTeam();
        if (!isApiError(res) && res.data) {
          setData(res.data);
        } else {
          notification.error({ message: t("manager.team.failedLoad") });
        }
      } catch {
        notification.error({ message: t("manager.team.failedLoad") });
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [t]);

  const columns = [
    { title: t("employees.form.empNumber"), dataIndex: "employee_id", key: "employee_id" },
    {
      title: t("common.name"),
      key: "name",
      render: (_: unknown, r: ManagerTeamMember) => r.full_name_en || r.full_name || "—",
    },
    { title: t("common.email"), dataIndex: "email", key: "email", render: (v: string) => v || "—" },
    { title: t("employees.form.mobile"), dataIndex: "mobile", key: "mobile", render: (v: string) => v || "—" },
    { title: t("profile.department"), dataIndex: "department", key: "department", render: (v: string) => v || "—" },
    { title: t("profile.position"), dataIndex: "position", key: "position", render: (v: string) => v || "—" },
  ];

  return (
    <div>
      <PageHeader title={t("manager.team.title")} subtitle={t("manager.team.subtitle")} />
      <Table dataSource={data} columns={columns} rowKey="id" loading={loading} scroll={{ x: 800 }} />
    </div>
  );
}
