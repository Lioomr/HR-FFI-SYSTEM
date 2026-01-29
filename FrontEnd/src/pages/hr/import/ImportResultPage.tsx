import React, { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Result, Button, Card, Spin, Typography, List, Alert } from "antd";
import { DownloadOutlined, UploadOutlined, HistoryOutlined } from "@ant-design/icons";
import { getImportStatus, downloadImportErrors } from "../../../services/api/employeesApi";
import type { ImportResult } from "../../../services/api/employeesApi";
import { unwrapEnvelope } from "../../../utils/dataUtils";

const { Text } = Typography;

const ImportResultPage: React.FC = () => {
    const { import_id } = useParams<{ import_id: string }>();
    const navigate = useNavigate();
    const [loading, setLoading] = useState(true);
    const [result, setResult] = useState<ImportResult | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [downloading, setDownloading] = useState(false);

    useEffect(() => {
        if (!import_id) {
            navigate("/hr/import/employees");
            return;
        }
        fetchStatus();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [import_id]);

    const fetchStatus = async () => {
        try {
            const response = await getImportStatus(import_id!);
            const data = unwrapEnvelope(response);
            setResult(data);
        } catch (err: any) {
            setError(err.message || "Failed to load import result");
        } finally {
            setLoading(false);
        }
    };

    const handleDownloadErrorFile = async () => {
        if (!import_id) return;
        setDownloading(true);
        try {
            const blob = await downloadImportErrors(import_id);
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `import-errors-${import_id}.xlsx`; // Default name
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);
        } catch (err) {
            console.error("Download failed", err);
            // Optionally show message
        } finally {
            setDownloading(false);
        }
    };

    if (loading) {
        return (
            <div style={{ textAlign: "center", padding: 50 }}>
                <Spin size="large" tip="Loading import status..." />
            </div>
        );
    }

    if (error || !result) {
        return (
            <Result
                status="500"
                title="Something went wrong"
                subTitle={error || "Could not retrieve import details."}
                extra={
                    <Button type="primary" onClick={() => navigate("/hr/import/employees")}>
                        Go Back
                    </Button>
                }
            />
        );
    }

    // Checking status with lowercase and uppercase to be resilient
    const status = result.status?.toLowerCase();
    const isSuccess = status === "completed" || status === "success";
    const isFailed = status === "failed";
    const isPending = status === "pending" || status === "processing";

    return (
        <div style={{ maxWidth: 800, margin: "0 auto", padding: "24px" }}>
            <Result
                status={isSuccess ? "success" : isFailed ? "error" : "info"}
                title={
                    isSuccess
                        ? "Import Completed Successfully"
                        : isFailed
                            ? "Import Failed"
                            : "Import Processing..."
                }
                subTitle={
                    isSuccess
                        ? `Successfully inserted ${result.inserted_rows} employees.`
                        : isPending
                            ? "Your file is being processed. You can refresh this page or check back later."
                            : "One or more errors occurred. No data was saved."
                }
                extra={[
                    <Button
                        type="primary"
                        key="upload"
                        icon={<UploadOutlined />}
                        onClick={() => navigate("/hr/import/employees")}
                    >
                        Upload New File
                    </Button>,
                    <Button
                        key="history"
                        icon={<HistoryOutlined />}
                        onClick={() => navigate("/hr/import/employees/history")}
                    >
                        View History
                    </Button>,
                ]}
            >
                {isFailed && (
                    <div className="desc">
                        <Alert
                            message="All-or-Nothing Import"
                            description="Because errors were found, the entire import was rejected to prevent partial data corruption."
                            type="error"
                            showIcon
                            style={{ marginBottom: 16 }}
                        />

                        {/* Shows button if there's an error summary OR url (legacy) or we decide to show it for all failed states */}
                        <div style={{ marginBottom: 24, textAlign: "center" }}>
                            <Button
                                type="dashed"
                                danger
                                icon={<DownloadOutlined />}
                                onClick={handleDownloadErrorFile}
                                loading={downloading}
                            >
                                Download Detailed Error Report (.xlsx)
                            </Button>
                        </div>

                        {result.error_summary && result.error_summary.length > 0 && (
                            <Card title="Error Summary" size="small" style={{ textAlign: "left" }}>
                                <List
                                    size="small"
                                    dataSource={result.error_summary}
                                    renderItem={(item) => (
                                        <List.Item>
                                            <Text type="danger">• {item}</Text>
                                        </List.Item>
                                    )}
                                />
                            </Card>
                        )}
                    </div>
                )}
            </Result>
        </div>
    );
};

export default ImportResultPage;
