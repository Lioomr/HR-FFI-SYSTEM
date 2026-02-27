import React, { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Result, Button, Card, Spin, Typography, List, Alert } from "antd";
import { DownloadOutlined, UploadOutlined, HistoryOutlined } from "@ant-design/icons";
import { getImportStatus, downloadImportErrors } from "../../../services/api/employeesApi";
import type { ImportResult } from "../../../services/api/employeesApi";
import { unwrapEnvelope } from "../../../utils/dataUtils";
import { useI18n } from "../../../i18n/useI18n";

const { Text } = Typography;

const ImportResultPage: React.FC = () => {
    const { import_id } = useParams<{ import_id: string }>();
    const navigate = useNavigate();
    const { t } = useI18n();
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
            setError(err.message || t("import.result.loadFail"));
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
                <Spin size="large" tip={t("import.result.loading")} />
            </div>
        );
    }

    if (error || !result) {
        return (
            <Result
                status="500"
                title={t("import.result.wrong")}
                subTitle={error || t("import.result.noDetails")}
                extra={
                    <Button type="primary" onClick={() => navigate("/hr/import/employees")}>
                        {t("common.back")}
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
                        ? t("import.result.successTitle")
                        : isFailed
                            ? t("import.result.failedTitle")
                            : t("import.result.processingTitle")
                }
                subTitle={
                    isSuccess
                        ? t("import.result.successDesc", { inserted: result.inserted_rows, total: result.row_count })
                        : isPending
                            ? t("import.result.processingDesc")
                            : t("import.result.failedDesc")
                }
                extra={[
                    <Button
                        type="primary"
                        key="upload"
                        icon={<UploadOutlined />}
                        onClick={() => navigate("/hr/import/employees")}
                    >
                        {t("import.result.uploadNew")}
                    </Button>,
                    <Button
                        key="history"
                        icon={<HistoryOutlined />}
                        onClick={() => navigate("/hr/import/employees/history")}
                    >
                        {t("import.result.viewHistory")}
                    </Button>,
                ]}
            >
                {isFailed && (
                    <div className="desc">
                        <Alert
                            message={t("import.result.alertTitle")}
                            description={t("import.result.alertDesc")}
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
                                {t("import.result.downloadError")}
                            </Button>
                        </div>

                        {result.error_summary && result.error_summary.length > 0 && (
                            <Card title={t("import.result.errorSummary")} size="small" style={{ textAlign: "left" }}>
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
