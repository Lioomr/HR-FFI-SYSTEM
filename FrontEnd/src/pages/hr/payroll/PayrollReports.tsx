import { useState } from "react";
import { Button, Card, Descriptions, Alert, Typography } from "antd";
import { FilePdfOutlined, FileExcelOutlined, DownloadOutlined } from "@ant-design/icons";
import { exportPayrollReport } from "../../../services/api/payrollApi";

interface PayrollReportsProps {
    runId: number;
    status: string;
}

export default function PayrollReports({ runId, status }: PayrollReportsProps) {
    const [downloading, setDownloading] = useState<"csv" | "pdf" | null>(null);

    const handleExport = async (format: "csv" | "pdf") => {
        setDownloading(format);
        try {
            const blob = await exportPayrollReport(runId, format);
            const url = window.URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.href = url;
            link.setAttribute("download", `payroll_run_${runId}_${format}.${format}`);
            document.body.appendChild(link);
            link.click();
            link.remove();
        } catch (err) {
            console.error("Export failed", err);
            // Ideally show notification
        } finally {
            setDownloading(null);
        }
    };

    return (
        <Card title="Payroll Reports" style={{ marginTop: 16, borderRadius: 16 }}>
            <Alert
                message="Reports Availability"
                description="Reports reflect the current state of the payroll run. For final accounting, ensure the run is finalized."
                type="info"
                showIcon
                style={{ marginBottom: 24 }}
            />

            <Descriptions bordered column={1}>
                <Descriptions.Item label="Payroll Register (CSV)">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                        <Typography.Text>Detailed list of all employees and salary components in CSV format.</Typography.Text>
                        <Button
                            icon={<FileExcelOutlined />}
                            onClick={() => handleExport("csv")}
                            loading={downloading === "csv"}
                        >
                            Export CSV
                        </Button>
                    </div>
                </Descriptions.Item>
                <Descriptions.Item label="Bank Transfer File (PDF)">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                        <Typography.Text>Summary PDF for bank transfer processing.</Typography.Text>
                        <Button
                            icon={<FilePdfOutlined />}
                            onClick={() => handleExport("pdf")}
                            loading={downloading === "pdf"}
                        >
                            Export PDF
                        </Button>
                    </div>
                </Descriptions.Item>
            </Descriptions>
        </Card>
    );
}
