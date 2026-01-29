import { useState } from "react";
import { Button, Card, Alert, notification, Descriptions } from "antd";
import { FileTextOutlined } from "@ant-design/icons";
import { generatePayslips } from "../../../services/api/payrollApi";
import { isApiError } from "../../../services/api/apiTypes";

interface PayrollPayslipsProps {
    runId: number;
    isFinalized: boolean; // Only enable generation if finalized
}

export default function PayrollPayslips({ runId, isFinalized }: PayrollPayslipsProps) {
    const [generating, setGenerating] = useState(false);
    const [generated, setGenerated] = useState(false);

    const handleGenerate = async () => {
        setGenerating(true);
        try {
            const res = await generatePayslips(runId);
            if (isApiError(res)) {
                notification.error({ message: "Generation Failed", description: res.message });
            } else {
                notification.success({ message: "Requests Sent", description: "Payslip generation has been requested." });
                setGenerated(true);
            }
        } catch (e) {
            notification.error({ message: "Error", description: "Could not trigger generation." });
        } finally {
            setGenerating(false);
        }
    };

    return (
        <Card title="Payslips" style={{ marginTop: 16, borderRadius: 16 }}>
            {!isFinalized && (
                <Alert
                    type="warning"
                    message="Payslip generation requires the payroll run to be Finalized."
                    showIcon
                    style={{ marginBottom: 16 }}
                />
            )}

            {generated && (
                <Alert
                    type="success"
                    message="Generation Requested"
                    description="The system is processing the payslips. They will be available shortly."
                    showIcon
                    style={{ marginBottom: 16 }}
                />
            )}

            <Descriptions title="Actions" bordered column={1}>
                <Descriptions.Item label="Generate Payslips">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                        <span>Triggers the generation of PDF payslips for all employees in this run.</span>
                        <Button
                            type="primary"
                            icon={<FileTextOutlined />}
                            onClick={handleGenerate}
                            disabled={!isFinalized || generating}
                            loading={generating}
                        >
                            Generate Payslips
                        </Button>
                    </div>
                </Descriptions.Item>
            </Descriptions>
        </Card>
    );
}
