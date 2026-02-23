import React, { useState } from "react";
import {
    Card,
    Typography,
    Form,
    InputNumber,
    Select,
    Button,
    message,
    Space,
} from "antd";
import { SearchOutlined, ReloadOutlined } from "@ant-design/icons";
import LeaveBalanceTable from "../../components/leaves/LeaveBalanceTable";
import leavesApi from "../../services/api/leavesApi";
import { unwrapEnvelope } from "../../utils/dataUtils";
import type { LeaveBalance } from "../../services/api/apiTypes";
import { useI18n } from "../../i18n/useI18n";

const { Title } = Typography;
const { Option } = Select;

const HrLeaveBalancesPage: React.FC = () => {
    const { t } = useI18n();
    const [employeeId, setEmployeeId] = useState<number | undefined>(undefined);
    const [year, setYear] = useState<number>(new Date().getFullYear());
    const [balances, setBalances] = useState<LeaveBalance[]>([]);
    const [loading, setLoading] = useState<boolean>(false);

    // Generate a list of years (e.g., current year +/- 5 years)
    const currentYear = new Date().getFullYear();
    const years = Array.from({ length: 11 }, (_, i) => currentYear - 5 + i).reverse();

    const handleSearch = async () => {
        if (!employeeId) {
            message.warning(t("hr.leaveBalances.idRequired"));
            return;
        }

        setLoading(true);
        setBalances([]); // Clear previous results while loading

        try {
            const response = await leavesApi.getEmployeeBalances(employeeId, year);
            const data = unwrapEnvelope<LeaveBalance[]>(response);
            setBalances(data);
        } catch (error: any) {
            console.error("Failed to fetch leave balances:", error);
            message.error(error.message || t("hr.leaveBalances.fetchFailed"));
            setBalances([]);
        } finally {
            setLoading(false);
        }
    };

    const handleReset = () => {
        setEmployeeId(undefined);
        setYear(new Date().getFullYear());
        setBalances([]);
    };

    return (
        <div className="p-6">
            <Card bordered={false} className="shadow-sm">
                <Space direction="vertical" size="large" style={{ width: "100%" }}>
                    <Title level={3}>{t("hr.leaveBalances.title")}</Title>

                    <Form layout="inline" onFinish={handleSearch}>
                        <Form.Item label={t("hr.leaveBalances.employeeId")} required>
                            <InputNumber
                                placeholder={t("hr.leaveBalances.enterEmployeeId")}
                                value={employeeId}
                                onChange={(val) => setEmployeeId(val || undefined)}
                                min={1}
                                style={{ width: 200 }}
                            />
                        </Form.Item>

                        <Form.Item label={t("hr.leaveBalances.year")}>
                            <Select
                                value={year}
                                onChange={(val) => setYear(val)}
                                style={{ width: 120 }}
                            >
                                {years.map((y) => (
                                    <Option key={y} value={y}>
                                        {y}
                                    </Option>
                                ))}
                            </Select>
                        </Form.Item>

                        <Form.Item>
                            <Space>
                                <Button
                                    type="primary"
                                    icon={<SearchOutlined />}
                                    onClick={handleSearch}
                                    loading={loading}
                                    htmlType="submit"
                                >
                                    {t("common.search")}
                                </Button>
                                <Button icon={<ReloadOutlined />} onClick={handleReset}>
                                    {t("common.refresh")}
                                </Button>
                            </Space>
                        </Form.Item>
                    </Form>

                    <LeaveBalanceTable balances={balances} loading={loading} />
                </Space>
            </Card>
        </div>
    );
};

export default HrLeaveBalancesPage;
