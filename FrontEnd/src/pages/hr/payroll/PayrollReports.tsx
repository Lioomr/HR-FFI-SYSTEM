import { useState } from "react";
import { Button, Card, Descriptions, Alert, Typography, Grid, Space, notification } from "antd";
import { FilePdfOutlined, FileExcelOutlined, DownloadOutlined } from "@ant-design/icons";
import { exportPayrollReport } from "../../../services/api/payrollApi";
import { useI18n } from "../../../i18n/useI18n";

interface PayrollReportsProps {
    runId: number;
    status: string;
}

const { useBreakpoint } = Grid;

export default function PayrollReports({ runId }: PayrollReportsProps) {
    const { t } = useI18n();
    const screens = useBreakpoint();
    const isMobile = !screens.md;
    const [downloading, setDownloading] = useState<"csv" | "pdf" | "xlsx" | null>(null);

    const handleExport = async (format: "csv" | "pdf" | "xlsx") => {
        setDownloading(format);
        try {
            // Note: The API must return a Blob. If using axios, responseType: 'blob' is crucial.
            const blob = await exportPayrollReport(runId, format);

            // Create a temporary URL
            const url = window.URL.createObjectURL(blob);

            // Temporary anchor for download
            const link = document.createElement("a");
            link.href = url;

            const ext = format === "xlsx" ? "xlsx" : format;
            link.setAttribute("download", `payroll_run_${runId}_${format}.${ext}`);

            document.body.appendChild(link);
            link.click();

            // Cleanup
            link.remove();
            window.URL.revokeObjectURL(url);
            notification.success({
                message: t("common.success"),
                description: t("payroll.runDetails.exportReady"),
            });

        } catch (err) {
            console.error("Export failed", err);
            notification.error({
                message: t("common.error"),
                description: t("payroll.runDetails.exportFailed"),
            });
        } finally {
            setDownloading(null);
        }
    };

    return (
        <Card title={t("payroll.runDetails.reportsTitle")} style={{ marginTop: 16, borderRadius: 16 }}>
            <Alert
                message={t("payroll.runDetails.reportsAvailability")}
                description={t("payroll.runDetails.reportsDesc")}
                type="info"
                showIcon
                style={{ marginBottom: 24 }}
            />

            <Descriptions bordered column={1}>
                <Descriptions.Item label={t("payroll.runDetails.csvReportName")}>
                    <Space
                        direction={isMobile ? "vertical" : "horizontal"}
                        size={12}
                        style={{ width: "100%", justifyContent: "space-between" }}
                    >
                        <Typography.Text>{t("payroll.runDetails.csvReportDesc")}</Typography.Text>
                        <Button
                            icon={<DownloadOutlined />}
                            onClick={() => handleExport("csv")}
                            loading={downloading === "csv"}
                            block={isMobile}
                        >
                            {t("payroll.runDetails.exportCsv")}
                        </Button>
                    </Space>
                </Descriptions.Item>

                <Descriptions.Item label={t("payroll.runDetails.excelReportName")}>
                    <Space
                        direction={isMobile ? "vertical" : "horizontal"}
                        size={12}
                        style={{ width: "100%", justifyContent: "space-between" }}
                    >
                        <Typography.Text>{t("payroll.runDetails.excelReportDesc")}</Typography.Text>
                        <Button
                            icon={<FileExcelOutlined />}
                            onClick={() => handleExport("xlsx")}
                            loading={downloading === "xlsx"}
                            type="primary"
                            ghost
                            block={isMobile}
                        >
                            {t("payroll.runDetails.exportExcel")}
                        </Button>
                    </Space>
                </Descriptions.Item>

                <Descriptions.Item label={t("payroll.runDetails.pdfReportName")}>
                    <Space
                        direction={isMobile ? "vertical" : "horizontal"}
                        size={12}
                        style={{ width: "100%", justifyContent: "space-between" }}
                    >
                        <Typography.Text>{t("payroll.runDetails.pdfReportDesc")}</Typography.Text>
                        <Button
                            icon={<FilePdfOutlined />}
                            onClick={() => handleExport("pdf")}
                            loading={downloading === "pdf"}
                            block={isMobile}
                        >
                            {t("payroll.runDetails.exportPdf")}
                        </Button>
                    </Space>
                </Descriptions.Item>
            </Descriptions>
        </Card>
    );
}
