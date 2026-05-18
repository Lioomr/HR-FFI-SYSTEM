import { useEffect, useState } from "react";
import { Button, Card, Space, Table, Tag, Tooltip, Typography, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import { DownloadOutlined } from "@ant-design/icons";
import dayjs from "dayjs";

import ErrorState from "../../../components/ui/ErrorState";
import LoadingState from "../../../components/ui/LoadingState";
import PageHeader from "../../../components/ui/PageHeader";
import { useI18n } from "../../../i18n/useI18n";
import { isApiError } from "../../../services/api/apiTypes";
import {
  downloadLabelJobPdf,
  listLabelJobs,
  type PrintedLabelJob,
} from "../../../services/api/assetsApi";
import { triggerBlobDownload } from "../../../services/api/downloads";

function formatDateTime(value?: string | null) {
  if (!value) return "-";
  const parsed = dayjs(value);
  return parsed.isValid() ? parsed.format("YYYY-MM-DD HH:mm") : value;
}

export default function LabelJobsHistoryPage() {
  const { t } = useI18n();
  const [apiMessage, contextHolder] = message.useMessage();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [jobs, setJobs] = useState<PrintedLabelJob[]>([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [total, setTotal] = useState(0);
  const [downloadingId, setDownloadingId] = useState<number | null>(null);

  const loadJobs = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await listLabelJobs({ page, page_size: pageSize });
      if (isApiError(res)) {
        setError(res.message || t("hr.assets.labelJobs.loadFailed"));
        return;
      }
      setJobs(res.data.items || []);
      setTotal(res.data.count || 0);
    } catch (err: any) {
      setError(err?.message || t("hr.assets.labelJobs.loadFailed"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadJobs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, pageSize]);

  const handleRedownload = async (job: PrintedLabelJob) => {
    try {
      setDownloadingId(job.id);
      const blob = await downloadLabelJobPdf(job.id);
      const stamp = dayjs(job.created_at).isValid()
        ? dayjs(job.created_at).format("YYYYMMDD-HHmm")
        : String(job.id);
      triggerBlobDownload(blob, `asset_labels_${stamp}.pdf`);
    } catch (err: any) {
      await apiMessage.error(err?.message || t("hr.assets.labelJobs.downloadFailed"));
    } finally {
      setDownloadingId(null);
    }
  };

  const paperSizeLabel = (size: string) => {
    const map: Record<string, string> = {
      "50X30": t("hr.assets.paperSize50x30"),
      "40X30": t("hr.assets.paperSize40x30"),
      "60X40": t("hr.assets.paperSize60x40"),
      A4_GRID: t("hr.assets.paperSizeA4Grid"),
    };
    return map[size] || size;
  };

  const columns: ColumnsType<PrintedLabelJob> = [
    {
      title: t("hr.assets.labelJobs.printedAt"),
      dataIndex: "created_at",
      key: "created_at",
      width: 180,
      render: (value: string) => formatDateTime(value),
    },
    {
      title: t("hr.assets.labelJobs.printedBy"),
      dataIndex: "created_by_name",
      key: "created_by_name",
      width: 220,
      render: (value?: string | null) => value || "-",
    },
    {
      title: t("hr.assets.labelJobs.assetCount"),
      dataIndex: "asset_count",
      key: "asset_count",
      width: 110,
    },
    {
      title: t("hr.assets.paperSize"),
      dataIndex: "paper_size",
      key: "paper_size",
      width: 170,
      render: (value: string) => <Tag>{paperSizeLabel(value)}</Tag>,
    },
    {
      title: t("hr.assets.labelJobs.assetCodes", "Asset Codes"),
      dataIndex: "asset_codes",
      key: "asset_codes",
      render: (codes: string[]) => {
        if (!codes || codes.length === 0) return "-";
        const preview = codes.slice(0, 6).join(", ");
        const suffix = codes.length > 6 ? ` +${codes.length - 6}` : "";
        return (
          <Tooltip title={codes.join(", ")}>
            <Typography.Text style={{ maxWidth: 360 }} ellipsis>
              {preview}
              {suffix}
            </Typography.Text>
          </Tooltip>
        );
      },
    },
    {
      title: t("common.actions"),
      key: "actions",
      width: 160,
      render: (_, record) => (
        <Space>
          <Button
            size="small"
            icon={<DownloadOutlined />}
            loading={downloadingId === record.id}
            onClick={() => void handleRedownload(record)}
          >
            {t("hr.assets.labelJobs.redownload")}
          </Button>
        </Space>
      ),
    },
  ];

  if (loading && jobs.length === 0) return <LoadingState title={t("hr.assets.labelJobs.loading")} lines={5} />;
  if (error) return <ErrorState title={t("common.error")} description={error} onRetry={() => void loadJobs()} />;

  return (
    <div>
      {contextHolder}
      <PageHeader
        title={t("hr.assets.labelJobs.title")}
        subtitle={t("hr.assets.labelJobs.subtitle")}
      />

      <Card>
        <Table
          rowKey="id"
          columns={columns}
          dataSource={jobs}
          loading={loading}
          pagination={{
            current: page,
            pageSize,
            total,
            showSizeChanger: true,
            onChange: (nextPage, nextSize) => {
              setPage(nextPage);
              setPageSize(nextSize);
            },
          }}
          scroll={{ x: "max-content" }}
        />
      </Card>
    </div>
  );
}
