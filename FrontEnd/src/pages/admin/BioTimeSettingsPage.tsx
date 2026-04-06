import React, { useEffect, useState } from "react";
import { Card, Form, Input, Button, Tabs, Switch, Table, Select, message, Spin, Space, Typography } from "antd";
import { useI18n } from "../../i18n/useI18n";
import { bioTimeApi } from "../../services/api/bioTimeApi";
import type { BioTimeConfig, UnmappedBioTimeUser, BioTimeEmployeeMap } from "../../services/api/bioTimeApi";
import { listEmployees } from "../../services/api/employeesApi";
import type { Employee } from "../../services/api/employeesApi";

const { Title, Text } = Typography;

const BioTimeSettingsPage: React.FC = () => {
    const { t } = useI18n();
    const [form] = Form.useForm<BioTimeConfig>();
    
    // Config State
    const [loadingConfig, setLoadingConfig] = useState(true);
    const [testingConnection, setTestingConnection] = useState(false);
    const [savingConfig, setSavingConfig] = useState(false);
    const [syncing, setSyncing] = useState(false);

    // Mappings State
    const [unmappedUsers, setUnmappedUsers] = useState<UnmappedBioTimeUser[]>([]);
    const [mappedUsers, setMappedUsers] = useState<BioTimeEmployeeMap[]>([]);
    const [systemEmployees, setSystemEmployees] = useState<Employee[]>([]);
    const [loadingMappings, setLoadingMappings] = useState(false);
    const [mappingSubmits, setMappingSubmits] = useState<Record<string, boolean>>({});
    const [selectedMappings, setSelectedMappings] = useState<Record<string, number | undefined>>({});

    useEffect(() => {
        loadConfig();
        loadMappingsData();
    }, []);

    const loadConfig = async () => {
        try {
            setLoadingConfig(true);
            const data = await bioTimeApi.getConfig();
            form.setFieldsValue(data);
        } catch (error) {
            message.error(t("bioTime.errors.loadConfig", "Failed to load BioTime configuration."));
        } finally {
            setLoadingConfig(false);
        }
    };

    const loadMappingsData = async () => {
        try {
            setLoadingMappings(true);
            const [unmapped, mapped, employeesRes] = await Promise.all([
                bioTimeApi.getUnmappedUsers().catch(() => []),
                bioTimeApi.getMappings().catch(() => []),
                listEmployees({ page_size: 1000 }).catch(() => ({ results: [] as Employee[] }))
            ]);
            
            const extractArray = (data: any) => {
                if (Array.isArray(data)) return data;
                if (data?.data && Array.isArray(data.data)) return data.data;
                if (data?.results && Array.isArray(data.results)) return data.results;
                return [];
            };

            setUnmappedUsers(extractArray(unmapped));
            setMappedUsers(extractArray(mapped));
            setSystemEmployees(extractArray(employeesRes));
        } catch (error) {
            message.error(t("bioTime.errors.loadMappings", "Failed to load mapping data."));
        } finally {
            setLoadingMappings(false);
        }
    };

    const handleSaveConfig = async (values: BioTimeConfig) => {
        try {
            setSavingConfig(true);
            await bioTimeApi.updateConfig(values);
            message.success(t("bioTime.success.saveConfig", "Configuration saved successfully."));
            loadConfig();
        } catch (error) {
            message.error(t("bioTime.errors.saveConfig", "Failed to save configuration."));
        } finally {
            setSavingConfig(false);
        }
    };

    const handleTestConnection = async () => {
        try {
            setTestingConnection(true);
            const values = form.getFieldsValue();
            await bioTimeApi.testConnection(values);
            message.success(t("bioTime.success.testConnection", "Connection successful!"));
        } catch (error) {
            message.error(t("bioTime.errors.testConnection", "Connection failed. Please check your settings."));
        } finally {
            setTestingConnection(false);
        }
    };

    const handleSyncNow = async () => {
        try {
            setSyncing(true);
            const res = await bioTimeApi.syncNow();
            message.success(res.message || t("bioTime.success.sync", "Sync triggered successfully."));
            loadMappingsData(); // Refresh unmapped users
        } catch (error: any) {
            message.error(error?.response?.data?.message || t("bioTime.errors.sync", "Failed to trigger sync."));
        } finally {
            setSyncing(false);
        }
    };

    const handleMapEmployee = async (empCode: string, employeeProfileId: number) => {
        try {
            setMappingSubmits(prev => ({ ...prev, [empCode]: true }));
            await bioTimeApi.createMapping({
                biotime_emp_code: empCode,
                employee_profile: employeeProfileId
            });
            setSelectedMappings(prev => ({ ...prev, [empCode]: undefined }));
            message.success(t("bioTime.success.map", "Employee mapped successfully."));
            await loadMappingsData();
        } catch (error) {
            message.error(t("bioTime.errors.map", "Failed to map employee."));
        } finally {
            setMappingSubmits(prev => ({ ...prev, [empCode]: false }));
        }
    };

    const handleDeleteMapping = async (id: number) => {
        try {
            await bioTimeApi.deleteMapping(id);
            message.success(t("bioTime.success.unmap", "Mapping removed successfully."));
            await loadMappingsData();
        } catch (error) {
            message.error(t("bioTime.errors.unmap", "Failed to remove mapping."));
        }
    };

    const configTab = (
        <Form form={form} layout="vertical" onFinish={handleSaveConfig}>
            {loadingConfig ? <Spin /> : (
                <>
                    <Form.Item name="server_ip" label={t("bioTime.fields.serverIp", "Server IP / Domain")} rules={[{ required: true }]}>
                        <Input placeholder="192.168.1.100" />
                    </Form.Item>

                    <Form.Item name="server_port" label={t("bioTime.fields.serverPort", "Server Port")} rules={[{ required: true }]}>
                        <Input placeholder="8090" />
                    </Form.Item>

                    <Form.Item name="username" label={t("bioTime.fields.username", "API Username")} rules={[{ required: true }]}>
                        <Input />
                    </Form.Item>

                    <Form.Item name="password" label={t("bioTime.fields.password", "API Password")}>
                        <Input.Password placeholder="Leave empty to keep unchanged" />
                    </Form.Item>

                    <Form.Item name="is_active" label={t("bioTime.fields.isActive", "Enable Auto-Sync")} valuePropName="checked">
                        <Switch />
                    </Form.Item>

                    <Space style={{ marginTop: 24 }}>
                        <Button type="primary" htmlType="submit" loading={savingConfig}>
                            {t("common.save", "Save Changes")}
                        </Button>
                        <Button onClick={handleTestConnection} loading={testingConnection}>
                            {t("bioTime.actions.testConnection", "Test Connection")}
                        </Button>
                        <Button onClick={handleSyncNow} loading={syncing} style={{ marginLeft: 24 }}>
                            {t("bioTime.actions.syncNow", "Sync Now from Device")}
                        </Button>
                    </Space>
                </>
            )}
        </Form>
    );

    const mappingsTab = (
        <div>
            <Title level={4}>{t("bioTime.titles.unmapped", "Unmapped Device Users")}</Title>
            <Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
                {t("bioTime.descriptions.unmapped", "These users were found on the fingerprint device but are not linked to any Employee Profile in the HR System. Please select an employee to link them to.")}
            </Text>
            
            <Table 
                dataSource={unmappedUsers} 
                rowKey="emp_code" 
                loading={loadingMappings}
                pagination={{ pageSize: 5 }}
            >
                <Table.Column title={t("bioTime.fields.empCode", "Device ID")} dataIndex="emp_code" />
                <Table.Column title={t("common.firstName", "First Name")} dataIndex="first_name" />
                <Table.Column title={t("common.lastName", "Last Name")} dataIndex="last_name" />
                <Table.Column 
                    title={t("bioTime.actions.mapTo", "Map to HR Employee")} 
                    render={(_, record: UnmappedBioTimeUser) => {
                        return (
                            <Space>
                                <Select 
                                    showSearch 
                                    placeholder={t("bioTime.placeholders.selectEmployee", "Select Employee")} 
                                    style={{ width: 250 }}
                                    value={selectedMappings[record.emp_code]}
                                    onChange={(value) =>
                                        setSelectedMappings((prev) => ({ ...prev, [record.emp_code]: value }))
                                    }
                                    filterOption={(input, option) =>
                                        (option?.label ?? '').toString().toLowerCase().includes(input.toLowerCase())
                                    }
                                    options={systemEmployees.map(emp => ({
                                        value: emp.id,
                                        label: `${emp.employee_number || emp.employee_id} - ${emp.full_name_en || emp.full_name}`
                                    }))}
                                />
                                <Button 
                                    type="primary" 
                                    onClick={() => {
                                        const employeeProfileId = selectedMappings[record.emp_code];
                                        if (employeeProfileId) {
                                            handleMapEmployee(record.emp_code, employeeProfileId);
                                        }
                                    }}
                                    disabled={!selectedMappings[record.emp_code]}
                                    loading={mappingSubmits[record.emp_code]}
                                >
                                    {t("common.link", "Link")}
                                </Button>
                            </Space>
                        );
                    }} 
                />
            </Table>

            <Title level={4} style={{ marginTop: 40 }}>{t("bioTime.titles.mapped", "Currently Mapped Users")}</Title>
            <Table 
                dataSource={mappedUsers} 
                rowKey="id" 
                loading={loadingMappings}
            >
                <Table.Column title={t("bioTime.fields.empCode", "Device ID")} dataIndex="biotime_emp_code" />
                <Table.Column title={t("common.employeeName", "Employee Name")} dataIndex="employee_name" />
                <Table.Column title={t("common.department", "Department")} dataIndex="department" />
                <Table.Column 
                    title={t("common.actions", "Actions")} 
                    render={(_, record: BioTimeEmployeeMap) => (
                        <Button danger onClick={() => handleDeleteMapping(record.id)}>
                            {t("common.unlink", "Unlink")}
                        </Button>
                    )} 
                />
            </Table>
        </div>
    );

    return (
        <Card title={t("bioTime.pageTitle", "ZKTeco BioTime 8.5 Integration Settings")}>
            <Tabs defaultActiveKey="1" items={[
                { key: "1", label: t("bioTime.tabs.config", "Connection Settings"), children: configTab },
                { key: "2", label: t("bioTime.tabs.mapping", "Employee Mapping"), children: mappingsTab },
            ]} />
        </Card>
    );
};

export default BioTimeSettingsPage;
