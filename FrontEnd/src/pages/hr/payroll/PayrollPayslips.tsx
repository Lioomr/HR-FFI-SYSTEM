import { useState } from "react";
import { Button, Card, Alert, notification, Descriptions } from "antd";
import { FileTextOutlined } from "@ant-design/icons";
import { generatePayslips } from "../../../services/api/payrollApi";
import { isApiError } from "../../../services/api/apiTypes";
import { useI18n } from "../../../i18n/useI18n";

interface PayrollPayslipsProps {
    runId: number;
    isFinalized: boolean; // Only enable generation if finalized
    runStatus?: string;
    onGenerated?: () => void | Promise<void>;
}

export default function PayrollPayslips({ runId, isFinalized, runStatus, onGenerated }: PayrollPayslipsProps) {
    const { t } = useI18n();
    const [generating, setGenerating] = useState(false);
    const [generated, setGenerated] = useState<{ generatedCount?: number; totalPayslips?: number } | null>(null);

    const handleGenerate = async () => {
        setGenerating(true);
        try {
            const res = await generatePayslips(runId);
            if (isApiError(res)) {
                notification.error({ message: t("payroll.runDetails.generationFailed"), description: res.message });
            } else {
                const generatedCount = res.data.generated_count ?? 0;
                const totalPayslips = res.data.total_payslips ?? 0;
                notification.success({
                    message: t("payroll.runDetails.payslipsReady"),
                    description: `${generatedCount} payslips updated. Total payslips: ${totalPayslips}.`,
                });
                setGenerated({ generatedCount, totalPayslips });

                if (onGenerated) {
                    await onGenerated();
                }
            }
        } catch (e) {
            notification.error({ message: t("common.error"), description: t("payroll.runDetails.couldNotTriggerGeneration") });
        } finally {
            setGenerating(false);
        }
    };

    return (
        <Card title={t("payroll.runDetails.payslipsTitle")} style={{ marginTop: 16, borderRadius: 16 }}>
            {!isFinalized && (
                <Alert
                    type="warning"
                    message={t("payroll.runDetails.payslipRequiresFinalized")}
                    showIcon
                    style={{ marginBottom: 16 }}
                />
            )}

            {generated && (
                <Alert
                    type="success"
                    message={t("payroll.runDetails.payslipsGeneratedTitle")}
                    description={`Updated ${generated.generatedCount ?? 0} payslips. Total available: ${generated.totalPayslips ?? 0}.`}
                    showIcon
                    style={{ marginBottom: 16 }}
                />
            )}

            <Descriptions title={t("common.actions")} bordered column={1}>
                <Descriptions.Item label={t("payroll.runDetails.btnGeneratePayslips")}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                        <span>{t("payroll.runDetails.generatePayslipsDesc")}</span>
                        <Button
                            type="primary"
                            icon={<FileTextOutlined />}
                            onClick={handleGenerate}
                            disabled={!isFinalized || generating || runStatus === "PAID"}
                            loading={generating}
                        >
                            {runStatus === "PAID" ? t("payroll.runDetails.payslipsGeneratedTitle") : t("payroll.runDetails.btnGeneratePayslips")}
                        </Button>
                    </div>
                </Descriptions.Item>
            </Descriptions>
        </Card>
    );
}
