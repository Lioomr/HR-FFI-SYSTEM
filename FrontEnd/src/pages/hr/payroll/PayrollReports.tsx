import { useState } from "react";
import { Button, Card, Descriptions, Alert, Typography, notification } from "antd";
import { FilePdfOutlined, FileExcelOutlined, DownloadOutlined } from "@ant-design/icons";
import { exportPayrollReport } from "../../../services/api/payrollApi";
import { useI18n } from "../../../i18n/useI18n";

interface PayrollReportsProps {
    runId: number;
    status: string;
}

export default function PayrollReports({ runId }: PayrollReportsProps) {
    const { t } = useI18n();
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
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                        <Typography.Text>{t("payroll.runDetails.csvReportDesc")}</Typography.Text>
                        <Button
                            icon={<DownloadOutlined />}
                            onClick={() => handleExport("csv")}
                            loading={downloading === "csv"}
                        >
                            {t("payroll.runDetails.exportCsv")}
                        </Button>
                    </div>
                </Descriptions.Item>

                <Descriptions.Item label={t("payroll.runDetails.excelReportName")}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                        <Typography.Text>{t("payroll.runDetails.excelReportDesc")}</Typography.Text>
                        <Button
                            icon={<FileExcelOutlined />}
                            onClick={() => handleExport("xlsx")}
                            loading={downloading === "xlsx"}
                            type="primary"
                            ghost
                        >
                            {t("payroll.runDetails.exportExcel")}
                        </Button>
                    </div>
                </Descriptions.Item>

                <Descriptions.Item label={t("payroll.runDetails.pdfReportName")}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                        <Typography.Text>{t("payroll.runDetails.pdfReportDesc")}</Typography.Text>
                        <Button
                            icon={<FilePdfOutlined />}
                            onClick={() => handleExport("pdf")}
                            loading={downloading === "pdf"}
                        >
                            {t("payroll.runDetails.exportPdf")}
                        </Button>
                    </div>
                </Descriptions.Item>
            </Descriptions>
        </Card>
    );
}
