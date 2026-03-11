import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Card, Table, Tag, Tooltip, notification, Form, Select, DatePicker, Row, Col, Modal, Input, Upload, Popconfirm } from "antd";
import type { ColumnsType } from "antd/es/table";
import { EyeOutlined, PlusOutlined, EditOutlined, DeleteOutlined } from "@ant-design/icons";
import type { UploadFile } from "antd/es/upload/interface";
import dayjs from "dayjs";

import PageHeader from "../../../components/ui/PageHeader";
import {
    createHRManualLeaveRequest,
    deleteHRManualLeaveRequest,
    getLeaveRequests,
    getLeaveTypes,
    updateHRManualLeaveRequest,
    type LeaveRequest,
    type LeaveRequestFilter,
    type LeaveType,
} from "../../../services/api/leaveApi";
import { isApiError } from "../../../services/api/apiTypes";
import { listEmployees, type Employee } from "../../../services/api/employeesApi";
import { useI18n } from "../../../i18n/useI18n";
import { apply422ToForm, getFirstApiErrorMessage } from "../../../utils/formErrors";
import LeaveApprovalMap from "../../../components/leaves/LeaveApprovalMap";

const { Option } = Select;
const { RangePicker } = DatePicker;
const { TextArea } = Input;

export default function LeaveInboxPage() {
    const navigate = useNavigate();
    const { t } = useI18n();

    // Translate leave type names from the API
    const translateLeaveType = (name?: string): string => {
        if (!name) return '-';
        const key = `leave.type.${name.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z_]/g, '')}`;
        const translated = t(key);
        return translated === key ? name : translated;
    };

    const [loading, setLoading] = useState(false);
    const [data, setData] = useState<LeaveRequest[]>([]);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(10);

    // Filters
    const [filters, setFilters] = useState<LeaveRequestFilter>({});
    const [form] = Form.useForm();
    const [manualForm] = Form.useForm();

    const [manualModalOpen, setManualModalOpen] = useState(false);
    const [manualModalLoading, setManualModalLoading] = useState(false);
    const [editingRecord, setEditingRecord] = useState<LeaveRequest | null>(null);
    const [employees, setEmployees] = useState<Employee[]>([]);
    const [leaveTypes, setLeaveTypes] = useState<LeaveType[]>([]);
    const selectedLeaveTypeId = Form.useWatch("leave_type", manualForm);
    const selectedLeaveType = leaveTypes.find((lt) => lt.id === selectedLeaveTypeId);
    const isSickSelected = ["SICK", "SICK_LEAVE"].includes((selectedLeaveType?.code || "").toUpperCase());

    const loadData = useCallback(async () => {
        setLoading(true);
        try {
            const res = await getLeaveRequests({ ...filters, page, page_size: pageSize });
            if (isApiError(res)) {
                notification.error({ message: t("error.generic"), description: res.message });
            } else {
                setData(res.data.items || []);
                setTotal(res.data.count || 0);
            }
        } catch (err: any) {
            notification.error({ message: t("common.error"), description: t("leave.noRequests") });
        } finally {
            setLoading(false);
        }
    }, [page, pageSize, filters]);

    const loadManualFormReferences = useCallback(async () => {
        try {
            const [employeesRes, leaveTypesRes] = await Promise.all([
                listEmployees({ page: 1, page_size: 300 }),
                getLeaveTypes(),
            ]);

            if (!isApiError(employeesRes)) {
                setEmployees(employeesRes.data.results || []);
            }
            if (!isApiError(leaveTypesRes)) {
                setLeaveTypes(leaveTypesRes.data || []);
            }
        } catch {
            notification.error({ message: t("common.error"), description: t("common.tryAgain") });
        }
    }, []);

    useEffect(() => {
        loadData();
    }, [loadData]);

    useEffect(() => {
        loadManualFormReferences();
    }, [loadManualFormReferences]);

    const handleFilterChange = (values: any) => {
        const newFilters: LeaveRequestFilter = {};
        if (values.status) newFilters.status = values.status;
        if (values.dates && values.dates[0]) {
            newFilters.date_from = values.dates[0].format("YYYY-MM-DD");
            newFilters.date_to = values.dates[1].format("YYYY-MM-DD");
        }
        setFilters(newFilters);
        setPage(1); // Reset to first page
    };

    const getStatusColor = (status: string) => {
        const s = status?.toLowerCase();
        switch (s) {
            case 'approved': return 'green';
            case 'rejected': return 'red';
            case 'submitted': return 'blue';
            case 'pending_manager': return 'orange';
            case 'pending_hr': return 'purple';
            case 'pending_ceo': return 'volcano';
            case 'pending': return 'gold';
            case 'cancelled': return 'default';
            default: return 'default';
        }
    };

    const columns: ColumnsType<LeaveRequest> = [
        {
            title: t("hr.dashboard.employee"),
            key: "employee",
            render: (_, record) => record.employee?.full_name || `ID: ${record.employee?.id}`
        },
        {
            title: t("leave.leaveType"),
            key: "leave_type",
            render: (_, record) => translateLeaveType(record.leave_type?.name)
        },
        {
            title: t("leave.startDate"),
            dataIndex: "start_date",
            key: "start_date",
        },
        {
            title: t("leave.days"),
            dataIndex: "days",
            key: "days",
            align: 'center'
        },
        {
            title: t("common.status"),
            dataIndex: "status",
            key: "status",
            render: (status, record) => {
                const statusKey = `leave.status.${status?.toLowerCase()}`;
                const translated = t(statusKey);
                const display = translated === statusKey
                    ? (status?.charAt(0).toUpperCase() + status?.slice(1).toLowerCase()).replace(/_/g, ' ')
                    : translated;
                return (
                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                        <Tag color={getStatusColor(status)}>{display}</Tag>
                        {record.source === "hr_manual" && <Tag color="cyan">{t("leave.manual.badge")}</Tag>}
                    </div>
                );
            }
        },
        {
            title: t("common.createdAt"),
            dataIndex: "created_at",
            key: "created_at",
            render: (val) => val ? new Date(val).toLocaleDateString() : '-'
        },
        {
            title: t("common.actions"),
            key: "actions",
            align: 'center',
            render: (_, record) => (
                <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
                    <Tooltip title={t("common.details")}>
                        <Button
                            icon={<EyeOutlined />}
                            onClick={() => navigate(`/hr/leave/requests/${record.id}`)}
                            size="small"
                        />
                    </Tooltip>
                    {record.source === "hr_manual" && (
                        <>
                            <Tooltip title={t("common.edit")}>
                                <Button
                                    icon={<EditOutlined />}
                                    size="small"
                                    onClick={() => openEditModal(record)}
                                />
                            </Tooltip>
                            <Popconfirm
                                title={t("leave.manual.deleteConfirm")}
                                okText={t("common.delete")}
                                cancelText={t("common.cancel")}
                                onConfirm={() => handleDeleteManual(record.id)}
                            >
                                <Button danger icon={<DeleteOutlined />} size="small" />
                            </Popconfirm>
                        </>
                    )}
                </div>
            ),
        },
    ];

    const openCreateModal = () => {
        setEditingRecord(null);
        manualForm.resetFields();
        setManualModalOpen(true);
    };

    const openEditModal = (record: LeaveRequest) => {
        const matchedEmployeeProfile = employees.find((e) => e.user_id === record.employee?.id);
        setEditingRecord(record);
        manualForm.setFieldsValue({
            employee_id: matchedEmployeeProfile?.id,
            leave_type: record.leave_type?.id,
            dates: [
                record.start_date ? dayjs(record.start_date) : null,
                record.end_date ? dayjs(record.end_date) : null,
            ],
            reason: record.reason || "",
            manual_entry_reason: record.manual_entry_reason || "",
            source_document_ref: record.source_document_ref || "",
            document: [],
        });
        setManualModalOpen(true);
    };

    const handleDeleteManual = async (id: number) => {
        try {
            const res = await deleteHRManualLeaveRequest(id);
            if (isApiError(res)) {
                notification.error({ message: t("common.error"), description: res.message });
                return;
            }
            notification.success({ message: t("leave.manual.deleted") });
            loadData();
        } catch {
            notification.error({ message: t("common.error"), description: t("common.tryAgain") });
        }
    };

    const handleSubmitManual = async () => {
        const values = await manualForm.validateFields();
        setManualModalLoading(true);
        try {
            const payload = new FormData();
            payload.append("employee_id", String(values.employee_id));
            payload.append("leave_type", String(values.leave_type));
            payload.append("start_date", values.dates[0].format("YYYY-MM-DD"));
            payload.append("end_date", values.dates[1].format("YYYY-MM-DD"));
            payload.append("reason", values.reason || "");
            payload.append("manual_entry_reason", values.manual_entry_reason || "");
            payload.append("source_document_ref", values.source_document_ref || "");

            const fileList = (values.document || []) as UploadFile[];
            const file = fileList[0]?.originFileObj;
            if (file) {
                payload.append("document", file);
            }

            const res = editingRecord
                ? await updateHRManualLeaveRequest(editingRecord.id, payload)
                : await createHRManualLeaveRequest(payload);

            if (isApiError(res)) {
                notification.error({ message: t("common.error"), description: res.message });
                return;
            }

            const warnings = res.data.warning_messages || [];
            if (warnings.length > 0) {
                notification.warning({
                    message: t("leave.manual.savedWithWarnings"),
                    description: warnings.join(" | "),
                    duration: 8,
                });
            } else {
                notification.success({ message: editingRecord ? t("leave.manual.updated") : t("leave.manual.created") });
            }

            setManualModalOpen(false);
            manualForm.resetFields();
            setEditingRecord(null);
            loadData();
        } catch (err: any) {
            if (!err?.errorFields) {
                apply422ToForm(manualForm, err);
                notification.error({
                    message: t("common.error"),
                    description: getFirstApiErrorMessage(err) || err?.message || t("common.tryAgain"),
                });
            }
        } finally {
            setManualModalLoading(false);
        }
    };

    return (
        <div style={{ maxWidth: 1200, margin: "0 auto" }}>
            <PageHeader
                title={t("leave.title")}
                subtitle={t("layout.leaveInbox")}
                actions={
                    <Button type="primary" icon={<PlusOutlined />} onClick={openCreateModal}>
                        {t("leave.manual.addButton")}
                    </Button>
                }
            />

            <Card style={{ marginBottom: 16, borderRadius: 16 }}>
                <Form form={form} layout="vertical" onValuesChange={handleFilterChange}>
                    <Row gutter={16}>
                        <Col span={8}>
                            <Form.Item label={t("common.status")} name="status">
                                <Select placeholder={t("employees.list.statusPlaceholder")} allowClear>
                                    <Option value="submitted">{t("status.pending")}</Option>
                                    <Option value="pending_manager">{t("status.pendingManager")}</Option>
                                    <Option value="pending_hr">{t("status.pendingHr")}</Option>
                                    <Option value="pending_ceo">{t("status.pendingCeo")}</Option>
                                    <Option value="approved">{t("status.approved")}</Option>
                                    <Option value="rejected">{t("status.rejected")}</Option>
                                    <Option value="cancelled">{t("status.cancelled")}</Option>
                                </Select>
                            </Form.Item>
                        </Col>
                        <Col span={8}>
                            <Form.Item label={t("leave.startDate") + " - " + t("leave.endDate")} name="dates">
                                <RangePicker style={{ width: '100%' }} />
                            </Form.Item>
                        </Col>
                    </Row>
                </Form>
            </Card>

            <Card style={{ borderRadius: 16 }}>
                <Table
                    dataSource={data}
                    columns={columns}
                    rowKey="id"
                    loading={loading}
                    expandable={{
                        expandedRowRender: (record) => <LeaveApprovalMap request={record} t={t} />,
                    }}
                    pagination={{
                        current: page,
                        pageSize,
                        total,
                        onChange: (p, ps) => {
                            setPage(p);
                            if (ps !== pageSize) setPageSize(ps);
                        },
                    }}
                />
            </Card>

            <Modal
                title={editingRecord ? t("leave.manual.editTitle") : t("leave.manual.addTitle")}
                open={manualModalOpen}
                onCancel={() => {
                    setManualModalOpen(false);
                    setEditingRecord(null);
                    manualForm.resetFields();
                }}
                onOk={handleSubmitManual}
                confirmLoading={manualModalLoading}
                okText={editingRecord ? t("common.save") : t("common.create")}
            >
                <Form form={manualForm} layout="vertical">
                    <Form.Item label={t("common.employee")} name="employee_id" rules={[{ required: true }]}>
                        <Select showSearch optionFilterProp="label" options={employees.map((e) => ({
                            value: e.id,
                            label: `${e.full_name_en || e.full_name || e.employee_id} (${e.employee_id})`,
                        }))} />
                    </Form.Item>
                    <Form.Item label={t("leave.leaveType")} name="leave_type" rules={[{ required: true }]}>
                        <Select options={leaveTypes.map((lt) => ({ value: lt.id, label: translateLeaveType(lt.name) }))} />
                    </Form.Item>
                    <Form.Item label={`${t("leave.startDate")} - ${t("leave.endDate")}`} name="dates" rules={[{ required: true }]}>
                        <RangePicker style={{ width: "100%" }} />
                    </Form.Item>
                    <Form.Item label={t("common.reason")} name="reason">
                        <TextArea rows={2} />
                    </Form.Item>
                    <Form.Item label={t("leave.manual.entryReason")} name="manual_entry_reason" rules={[{ required: true }]}>
                        <TextArea rows={2} />
                    </Form.Item>
                    <Form.Item label={t("leave.manual.sourceDocumentRef")} name="source_document_ref" rules={[{ required: true }]}>
                        <Input />
                    </Form.Item>
                    <Form.Item
                        label={t("common.document")}
                        name="document"
                        valuePropName="fileList"
                        getValueFromEvent={(e) => (Array.isArray(e) ? e : e?.fileList || [])}
                        rules={[
                            {
                                validator: (_, value: UploadFile[]) => {
                                    if (!isSickSelected) return Promise.resolve();
                                    const hasExistingDocument = Boolean(editingRecord?.document);
                                    if (hasExistingDocument) return Promise.resolve();
                                    return value && value.length > 0
                                        ? Promise.resolve()
                                        : Promise.reject(new Error(t("leave.manual.sickDocRequired")));
                                },
                            },
                        ]}
                    >
                        <Upload beforeUpload={() => false} maxCount={1} accept=".pdf,.png,.jpg,.jpeg">
                            <Button>{t("leave.chooseFile")}</Button>
                        </Upload>
                    </Form.Item>
                </Form>
            </Modal>
        </div>
    );
}
