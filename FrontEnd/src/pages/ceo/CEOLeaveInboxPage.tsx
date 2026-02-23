import { useCallback, useEffect, useState } from "react";
import { Button, Card, Table, Tag, Modal, Input, Alert, notification, Space, Tooltip } from "antd";
import { CheckCircleOutlined, CloseCircleOutlined, EyeOutlined, DownloadOutlined } from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";

import PageHeader from "../../components/ui/PageHeader";
import LoadingState from "../../components/ui/LoadingState";
import ErrorState from "../../components/ui/ErrorState";
import { useI18n } from "../../i18n/useI18n";
import { getCEOLeaveRequests, approveCEOLeaveRequest, rejectCEOLeaveRequest, getLeaveRequestDocumentBlob, type LeaveRequest } from "../../services/api/leaveApi";
import { isApiError } from "../../services/api/apiTypes";

const { TextArea } = Input;

export default function CEOLeaveInboxPage() {
    const { t } = useI18n();
    const [loading, setLoading] = useState(true);
    const [requests, setRequests] = useState<LeaveRequest[]>([]);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);
    const [error, setError] = useState<string | null>(null);

    const [rejectModalVisible, setRejectModalVisible] = useState(false);
    const [rejectingId, setRejectingId] = useState<number | null>(null);
    const [rejectionComment, setRejectionComment] = useState("");
    const [processing, setProcessing] = useState(false);
    const [documentLoading, setDocumentLoading] = useState<number | null>(null);

    const loadData = useCallback(async (p = 1) => {
        setLoading(true);
        try {
            const res = await getCEOLeaveRequests({ page: p, page_size: 20 });
            if (isApiError(res)) {
                setError(res.message);
            } else {
                setRequests(res.data?.items ?? []);
                setTotal(res.data?.count ?? 0);
            }
        } catch (e: any) {
            setError(e.message || t("common.tryAgain"));
        } finally {
            setLoading(false);
        }
    }, [t]);

    useEffect(() => {
        loadData(page);
    }, [loadData, page]);

    const handleApprove = (record: LeaveRequest) => {
        Modal.confirm({
            title: t("ceo.leaveApprovals.approveTitle"),
            content: `${record.employee?.full_name} (${record.days} ${t("leave.days")})`,
            okText: t("common.approve"),
            okType: "primary",
            cancelText: t("common.cancel"),
            onOk: async () => {
                setProcessing(true);
                try {
                    const res = await approveCEOLeaveRequest(record.id);
                    if (isApiError(res)) {
                        notification.error({ message: t("common.error"), description: res.message });
                    } else {
                        notification.success({ message: t("leave.approved") });
                        loadData(page);
                    }
                } catch {
                    notification.error({ message: t("common.error"), description: t("common.tryAgain") });
                } finally {
                    setProcessing(false);
                }
            }
        });
    };

    const openRejectModal = (id: number) => {
        setRejectingId(id);
        setRejectionComment("");
        setRejectModalVisible(true);
    };

    const handleReject = async () => {
        if (!rejectingId || !rejectionComment.trim()) {
            notification.error({ message: t("common.error"), description: t("common.required") });
            return;
        }
        setProcessing(true);
        try {
            const res = await rejectCEOLeaveRequest(rejectingId, rejectionComment);
            if (isApiError(res)) {
                notification.error({ message: t("common.error"), description: res.message });
            } else {
                notification.success({ message: t("leave.rejected") });
                setRejectModalVisible(false);
                setRejectingId(null);
                loadData(page);
            }
        } catch {
            notification.error({ message: t("common.error"), description: t("common.tryAgain") });
        } finally {
            setProcessing(false);
        }
    };

    const handleDocumentBlobAction = async (id: number, download: boolean) => {
        setDocumentLoading(id);
        try {
            const blob = await getLeaveRequestDocumentBlob(id, download);
            const url = window.URL.createObjectURL(blob);
            if (download) {
                const link = document.createElement("a");
                link.href = url;
                link.download = `leave_request_${id}_document`;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
            } else {
                window.open(url, "_blank", "noopener,noreferrer");
            }
            setTimeout(() => window.URL.revokeObjectURL(url), 5000);
        } catch {
            notification.error({ message: t("common.error"), description: t("common.tryAgain") });
        } finally {
            setDocumentLoading(null);
        }
    };

    const columns: ColumnsType<LeaveRequest> = [
        { title: "#", dataIndex: "id", key: "id", width: 60 },
        {
            title: t("ceo.leaveApprovals.employee"),
            key: "employee",
            render: (_, r) => r.employee?.full_name || `ID: ${r.employee?.id}`,
        },
        {
            title: t("leave.type"),
            key: "leave_type",
            render: (_, r) => r.leave_type?.name,
        },
        {
            title: t("ceo.leaveApprovals.period"),
            key: "period",
            render: (_, r) => `${r.start_date} → ${r.end_date}`,
        },
        { title: t("leave.days"), dataIndex: "days", key: "days", width: 70 },
        {
            title: t("common.status"),
            key: "status",
            render: (_, r) => (
                <Tag color="volcano">
                    {(r.status || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
                </Tag>
            ),
        },
        {
            title: t("ceo.leaveApprovals.document"),
            key: "document",
            render: (_, r) =>
                r.document ? (
                    <Space>
                        <Tooltip title={t("common.view")}>
                            <Button
                                size="small"
                                icon={<EyeOutlined />}
                                loading={documentLoading === r.id}
                                onClick={() => handleDocumentBlobAction(r.id, false)}
                            />
                        </Tooltip>
                        <Tooltip title={t("common.download")}>
                            <Button
                                size="small"
                                icon={<DownloadOutlined />}
                                loading={documentLoading === r.id}
                                onClick={() => handleDocumentBlobAction(r.id, true)}
                            />
                        </Tooltip>
                    </Space>
                ) : (
                    <span style={{ color: '#aaa' }}>—</span>
                ),
        },
        {
            title: t("common.actions"),
            key: "actions",
            width: 160,
            render: (_, r) => (
                <Space>
                    <Button
                        type="primary"
                        size="small"
                        icon={<CheckCircleOutlined />}
                        loading={processing}
                        onClick={() => handleApprove(r)}
                    >
                        {t("common.approve")}
                    </Button>
                    <Button
                        danger
                        size="small"
                        icon={<CloseCircleOutlined />}
                        onClick={() => openRejectModal(r.id)}
                    >
                        {t("common.reject")}
                    </Button>
                </Space>
            ),
        },
    ];

    if (error) return <ErrorState title={t("ceo.leaveApprovals.title")} description={error} onRetry={() => loadData(1)} />;

    return (
        <div>
            <PageHeader
                title={t("ceo.leaveApprovals.title")}
                subtitle={t("ceo.leaveApprovals.subtitle")}
            />

            {loading ? (
                <LoadingState title={t("loading.generic")} />
            ) : (
                <Card style={{ borderRadius: 16, border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.03)' }}>
                    <Table
                        columns={columns}
                        dataSource={requests}
                        rowKey="id"
                        pagination={{
                            current: page,
                            total,
                            pageSize: 20,
                            showSizeChanger: false,
                            onChange: (p) => setPage(p),
                        }}
                        locale={{ emptyText: t("ceo.leaveApprovals.noRequests") }}
                    />
                </Card>
            )}

            {/* Reject Modal */}
            <Modal
                title={t("ceo.leaveApprovals.rejectTitle")}
                open={rejectModalVisible}
                onOk={handleReject}
                onCancel={() => setRejectModalVisible(false)}
                okText={t("ceo.leaveApprovals.rejectConfirm")}
                okType="danger"
                confirmLoading={processing}
            >
                <Alert
                    type="warning"
                    message={t("ceo.leaveApprovals.rejectWarning")}
                    showIcon
                    style={{ marginBottom: 16 }}
                />
                <TextArea
                    rows={4}
                    placeholder={t("ceo.leaveApprovals.rejectComment")}
                    value={rejectionComment}
                    onChange={e => setRejectionComment(e.target.value)}
                />
            </Modal>
        </div>
    );
}
