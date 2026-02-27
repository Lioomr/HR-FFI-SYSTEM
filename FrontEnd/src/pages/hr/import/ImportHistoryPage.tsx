import React, { useEffect, useState } from "react";
import { Table, Tag, Button, Space, DatePicker, Select, Card, Tooltip, message } from "antd";
import { ReloadOutlined, DownloadOutlined } from "@ant-design/icons";
import { getImportHistory, downloadImportErrors } from "../../../services/api/employeesApi";
import type { ImportHistoryItem } from "../../../services/api/employeesApi";
import { unwrapEnvelope } from "../../../utils/dataUtils";
import { useI18n } from "../../../i18n/useI18n";
import type { ColumnsType } from "antd/es/table";
import dayjs from "dayjs";

const { RangePicker } = DatePicker;
const { Option } = Select;

const ImportHistoryPage: React.FC = () => {
    const { t } = useI18n();
    const [loading, setLoading] = useState(false);
    const [data, setData] = useState<ImportHistoryItem[]>([]);
    const [total, setTotal] = useState(0);
    const [downloadingId, setDownloadingId] = useState<string | null>(null);

    // Filters
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(10);
    const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined);
    const [dateRange, setDateRange] = useState<[dayjs.Dayjs | null, dayjs.Dayjs | null] | null>(null);

    const fetchHistory = async () => {
        setLoading(true);
        try {
            const params: any = {
                page,
                page_size: pageSize,
                status: statusFilter,
            };

            if (dateRange && dateRange[0] && dateRange[1]) {
                params.date_from = dateRange[0].format("YYYY-MM-DD");
                params.date_to = dateRange[1].format("YYYY-MM-DD");
            }

            const response = await getImportHistory(params);
            const unwrapped = unwrapEnvelope(response);

            // StandardPagination returns { items, count, page, page_size, total_pages }
            const items = unwrapped.items || [];
            const count = unwrapped.count || 0;

            setData(items);
            setTotal(count);
        } catch (error) {
            console.error(error);
        } finally {
            setLoading(false);
        }
    };

    const handleDownloadErrorFile = async (id: string) => {
        setDownloadingId(id);
        try {
            const blob = await downloadImportErrors(id);
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `import-errors-${id}.xlsx`; // Default name
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);
        } catch (err) {
            message.error(t("import.history.downloadFail"));
            console.error(err);
        } finally {
            setDownloadingId(null);
        }
    };

    useEffect(() => {
        fetchHistory();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [page, pageSize, statusFilter, dateRange]);

    const columns: ColumnsType<ImportHistoryItem> = [
        {
            title: t("common.date"),
            dataIndex: "created_at",
            key: "created_at",
            render: (val: string) => dayjs(val).format("YYYY-MM-DD HH:mm"),
        },
        {
            title: t("import.history.uploadedBy"),
            dataIndex: "uploader",
            key: "uploader",
        },
        // Backend does not return filename, so column removed.
        {
            title: t("common.status"),
            dataIndex: "status",
            key: "status",
            render: (val: string) => {
                const status = val?.toLowerCase();
                let color = "default";
                if (status === "completed" || status === "success") color = "success";
                if (status === "failed") color = "error";
                if (status === "processing" || status === "pending") color = "processing";
                return <Tag color={color}>{status?.toUpperCase() || val}</Tag>;
            },
        },
        {
            title: t("import.history.totalRows"),
            dataIndex: "row_count",
            key: "row_count",
            align: 'center',
        },
        {
            title: t("import.history.inserted"),
            dataIndex: "inserted_rows",
            key: "inserted_rows",
            align: 'center',
            render: (val, record) => {
                const status = record.status?.toLowerCase();
                return (status === "completed" || status === "success") ? val : "-";
            },
        },
        {
            title: t("common.actions"),
            key: "actions",
            render: (_, record) => (
                record.status?.toLowerCase() === 'failed' ? (
                    <Tooltip title={t("import.history.downloadError")}>
                        <Button
                            type="link"
                            danger
                            icon={<DownloadOutlined />}
                            onClick={() => handleDownloadErrorFile(record.id)}
                            loading={downloadingId === record.id}
                        />
                    </Tooltip>
                ) : "-"
            ),
        },
    ];

    return (
        <Card
            title={t("import.history.title")}
            extra={
                <Button icon={<ReloadOutlined />} onClick={fetchHistory}>
                    {t("common.refresh")}
                </Button>
            }
        >
            <Space style={{ marginBottom: 16 }} wrap>
                <Select
                    placeholder={t("import.history.filterStatus")}
                    allowClear
                    style={{ width: 150 }}
                    onChange={setStatusFilter}
                    value={statusFilter}
                >
                    <Option value="SUCCESS">{t("import.history.success")}</Option>
                    <Option value="FAILED">{t("import.history.failed")}</Option>
                    <Option value="PROCESSING">{t("import.history.processing")}</Option>
                </Select>

                <RangePicker
                    onChange={(dates) => setDateRange(dates as any)}
                    value={dateRange as any}
                />
            </Space>

            <Table
                columns={columns}
                dataSource={data}
                rowKey="id"
                loading={loading}
                scroll={{ x: 700 }}
                pagination={{
                    current: page,
                    pageSize: pageSize,
                    total: total,
                    onChange: (p, ps) => {
                        setPage(p);
                        setPageSize(ps);
                    },
                    showSizeChanger: true,
                }}
            />
        </Card>
    );
};

export default ImportHistoryPage;
