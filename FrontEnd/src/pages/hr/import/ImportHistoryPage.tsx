import React, { useEffect, useState } from "react";
import { Table, Tag, Button, Space, DatePicker, Select, Card, Tooltip, message } from "antd";
import { ReloadOutlined, DownloadOutlined, FileExcelOutlined } from "@ant-design/icons";
import { getImportHistory, downloadImportErrors } from "../../../services/api/employeesApi";
import type { ImportHistoryItem } from "../../../services/api/employeesApi";
import { unwrapEnvelope } from "../../../utils/dataUtils";
import type { ColumnsType } from "antd/es/table";
import dayjs from "dayjs";

const { RangePicker } = DatePicker;
const { Option } = Select;

const ImportHistoryPage: React.FC = () => {
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
            const { results, count } = unwrapEnvelope(response);

            // Should verify if normalizeListData is actually needed here or if the API returns direct structure
            // Based on employeesApi.ts -> getImportHistory returns ApiResponse<{ results: ..., count: ... }>
            // So unwrapEnvelope gives { results, count } directly.

            setData(results);
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
            message.error("Failed to download error file");
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
            title: "Date",
            dataIndex: "uploaded_at",
            key: "uploaded_at",
            render: (val: string) => dayjs(val).format("YYYY-MM-DD HH:mm"),
        },
        {
            title: "Uploaded By",
            dataIndex: "uploaded_by",
            key: "uploaded_by",
        },
        {
            title: "File Name",
            dataIndex: "file_name",
            key: "file_name",
            render: (text) => <Space><FileExcelOutlined /> {text}</Space>
        },
        {
            title: "Status",
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
            title: "Inserted",
            dataIndex: "inserted_rows",
            key: "inserted_rows",
            render: (val, record) => {
                const status = record.status?.toLowerCase();
                return (status === "completed" || status === "success") ? val : "-";
            },
        },
        {
            title: "Actions",
            key: "actions",
            render: (_, record) => (
                record.has_error_file ? (
                    <Tooltip title="Download Error File">
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
            title="Import History"
            extra={
                <Button icon={<ReloadOutlined />} onClick={fetchHistory}>
                    Refresh
                </Button>
            }
        >
            <Space style={{ marginBottom: 16 }} wrap>
                <Select
                    placeholder="Filter by Status"
                    allowClear
                    style={{ width: 150 }}
                    onChange={setStatusFilter}
                    value={statusFilter}
                >
                    <Option value="SUCCESS">Success</Option>
                    <Option value="FAILED">Failed</Option>
                    <Option value="PROCESSING">Processing</Option>
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
