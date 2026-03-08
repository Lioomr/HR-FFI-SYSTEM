import { useEffect, useState } from "react";
import { Button, Input, Modal, Space, Table, Tag, message } from "antd";
import type { ColumnsType } from "antd/es/table";

import PageHeader from "../../components/ui/PageHeader";
import {
  approveCEOAssetDamageReport,
  getCEOAssetDamageReports,
  rejectCEOAssetDamageReport,
  type AssetDamageReport,
} from "../../services/api/assetsApi";
import { isApiError } from "../../services/api/apiTypes";
import { useI18n } from "../../i18n/useI18n";

const statusColor: Record<string, string> = {
  PENDING_CEO: "purple",
  APPROVED: "green",
  REJECTED: "red",
};

export default function CEOAssetDamageReportsPage() {
  const { t } = useI18n();
  const [items, setItems] = useState<AssetDamageReport[]>([]);
  const [loading, setLoading] = useState(false);
  const [rejectingId, setRejectingId] = useState<number | string | null>(null);
  const [note, setNote] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const res = await getCEOAssetDamageReports({ status: "PENDING_CEO", page: 1, page_size: 100 });
      if (isApiError(res)) {
        message.error(res.message || t("common.error.generic"));
        return;
      }
      const data: any = (res as any).data;
      const rows = Array.isArray(data?.items) ? data.items : Array.isArray(data) ? data : [];
      setItems(rows);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const onApprove = async (id: number | string) => {
    const res = await approveCEOAssetDamageReport(id, "Approved by CEO");
    if (isApiError(res)) {
      message.error(res.message || t("common.error.generic"));
      return;
    }
    message.success(t("common.approve"));
    void load();
  };

  const onReject = async () => {
    if (!rejectingId || !note.trim()) return;
    const res = await rejectCEOAssetDamageReport(rejectingId, note.trim());
    if (isApiError(res)) {
      message.error(res.message || t("common.error.generic"));
      return;
    }
    message.success(t("common.reject"));
    setRejectingId(null);
    setNote("");
    void load();
  };

  const columns: ColumnsType<AssetDamageReport> = [
    { title: t("assets.assetCode"), dataIndex: "asset_code", key: "asset_code" },
    { title: t("hr.dashboard.employee"), dataIndex: "employee_name", key: "employee_name" },
    { title: t("common.details"), dataIndex: "description", key: "description" },
    {
      title: t("common.status"),
      dataIndex: "status",
      key: "status",
      render: (value: string) => <Tag color={statusColor[value] || "default"}>{value}</Tag>,
    },
    {
      title: t("common.actions"),
      key: "actions",
      render: (_, record) => (
        <Space>
          <Button size="small" type="primary" onClick={() => void onApprove(record.id)}>
            {t("common.approve")}
          </Button>
          <Button size="small" danger onClick={() => setRejectingId(record.id)}>
            {t("common.reject")}
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <PageHeader title={t("assets.damageReports", "Damage Reports")} subtitle={t("ceo.dashboard.subtitle")} />
      <Table rowKey="id" dataSource={items} columns={columns} loading={loading} pagination={false} />
      <Modal
        open={!!rejectingId}
        title={t("common.reject")}
        onCancel={() => {
          setRejectingId(null);
          setNote("");
        }}
        onOk={() => void onReject()}
      >
        <Input.TextArea rows={4} value={note} onChange={(e) => setNote(e.target.value)} />
      </Modal>
    </div>
  );
}
