import { useCallback, useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Button, Card, Descriptions, Divider, Alert, Tag, Modal, Input, notification } from "antd";
import { ArrowLeftOutlined, CheckCircleOutlined, CloseCircleOutlined, EyeOutlined, DownloadOutlined, ExportOutlined } from "@ant-design/icons";

import PageHeader from "../../../components/ui/PageHeader";
import LoadingState from "../../../components/ui/LoadingState";
import ErrorState from "../../../components/ui/ErrorState";
import { getLeaveRequest, approveLeaveRequest, rejectLeaveRequest, sendLeaveRequestToCEO, getLeaveRequestDocumentBlob, type LeaveRequest } from "../../../services/api/leaveApi";
import { isApiError } from "../../../services/api/apiTypes";
import { useI18n } from "../../../i18n/useI18n";

const { confirm } = Modal;
const { TextArea } = Input;

export default function LeaveRequestDetailsPage() {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const { t } = useI18n();

    // Translate leave type names from the API
    const translateLeaveType = (name?: string): string => {
        if (!name) return '-';
        const key = `leave.type.${name.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z_]/g, '')}`;
        const translated = t(key);
        return translated === key ? name : translated;
    };

    const [loading, setLoading] = useState(true);
    const [request, setRequest] = useState<LeaveRequest | null>(null);
    const [error, setError] = useState<string | null>(null);

    // Action States
    const [processing, setProcessing] = useState(false);
    const [documentLoading, setDocumentLoading] = useState(false);
    const [rejectModalVisible, setRejectModalVisible] = useState(false);
    const [rejectionReason, setRejectionReason] = useState("");

    const loadData = useCallback(async () => {
        if (!id) return;
        setLoading(true);
        try {
            const res = await getLeaveRequest(id);
            if (isApiError(res)) {
                setError(res.message);
            } else {
                setRequest(res.data);
            }
        } catch (e: any) {
            setError(e.message || t("leave.loadFail"));
        } finally {
            setLoading(false);
        }
    }, [id]);

    useEffect(() => {
        loadData();
    }, [loadData]);

    const handleApprove = () => {
        if (!request) return;
        confirm({
            title: t("leave.approveTitle"),
            content: t("leave.approveConfirm", { name: request.employee?.full_name || '', days: request.days }),
            okText: t("common.approve"),
            okType: "primary",
            cancelText: t("common.cancel"),
            onOk: async () => {
                setProcessing(true);
                try {
                    const res = await approveLeaveRequest(request.id);
                    if (isApiError(res)) {
                        notification.error({ message: t("leave.approveFail"), description: res.message });
                    } else {
                        notification.success({ message: t("leave.approveSuccess") });
                        loadData();
                    }
                } catch (e) {
                    notification.error({ message: t("common.error"), description: t("leave.approveError") });
                } finally {
                    setProcessing(false);
                }
            }
        });
    };

    const handleSendToCEO = () => {
        if (!request) return;
        confirm({
            title: t("leave.sendToCeoTitle"),
            content: t("leave.sendToCeoDesc"),
            okText: t("leave.sendToCeoBtn"),
            okType: "primary",
            cancelText: t("common.cancel"),
            onOk: async () => {
                setProcessing(true);
                try {
                    const res = await sendLeaveRequestToCEO(request.id);
                    if (isApiError(res)) {
                        notification.error({ message: t("leave.sendFail"), description: res.message });
                    } else {
                        notification.success({ message: t("leave.sendSuccess") });
                        loadData();
                    }
                } catch {
                    notification.error({ message: t("common.error"), description: t("leave.sendError") });
                } finally {
                    setProcessing(false);
                }
            }
        });
    };

    const openDocument = async (download: boolean) => {
        if (!request) return;
        setDocumentLoading(true);
        try {
            const blob = await getLeaveRequestDocumentBlob(request.id, download);
            const url = window.URL.createObjectURL(blob);
            if (download) {
                const link = document.createElement("a");
                link.href = url;
                link.download = `leave_request_${request.id}_document`;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
            } else {
                window.open(url, "_blank", "noopener,noreferrer");
            }
            setTimeout(() => window.URL.revokeObjectURL(url), 5000);
        } catch {
            notification.error({ message: t("leave.docErrorTitle"), description: t("leave.docErrorDesc") });
        } finally {
            setDocumentLoading(false);
        }
    };

    const handleReject = async () => {
        if (!request || !rejectionReason.trim()) {
            notification.error({ message: t("leave.reasonReqTitle"), description: t("leave.reasonReqDesc") });
            return;
        }

        setProcessing(true);
        try {
            const res = await rejectLeaveRequest(request.id, rejectionReason);
            if (isApiError(res)) {
                notification.error({ message: t("leave.rejectFail"), description: res.message });
            } else {
                notification.success({ message: t("leave.rejectSuccess") });
                setRejectModalVisible(false);
                setRejectionReason("");
                loadData();
            }
        } catch (e) {
            notification.error({ message: t("common.error"), description: t("leave.rejectError") });
        } finally {
            setProcessing(false);
        }
    };

    if (loading) return <LoadingState title="Loading request details..." />;
    if (error) return <ErrorState title="Error" description={error} onRetry={loadData} />;
    if (!request) return <ErrorState title="Not Found" description="Leave request not found." />;

    // HR can only action submitted or pending_hr requests.
    // pending_ceo requests must go to the CEO portal.
    const canAction = request.status?.toLowerCase() === 'submitted' ||
        request.status?.toLowerCase() === 'pending_hr';
    const canSendToCEO = canAction;

    const statusLabel = (() => {
        const statusKey = `leave.status.${(request.status || '').toLowerCase()}`;
        const translated = t(statusKey);
        return translated === statusKey
            ? (request.status || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
            : translated;
    })();

    const statusColor = () => {
        const s = request.status?.toLowerCase();
        if (s === 'approved') return 'green';
        if (s === 'rejected') return 'red';
        if (s === 'pending_ceo') return 'volcano';
        if (s === 'pending_hr') return 'purple';
        if (s === 'pending_manager') return 'orange';
        return 'blue';
    };

    return (
        <div style={{ maxWidth: 800, margin: "0 auto" }}>
            <Button
                type="link"
                icon={<ArrowLeftOutlined />}
                onClick={() => navigate("/hr/leave/requests")}
                style={{ paddingLeft: 0, marginBottom: 16 }}
            >
                {t("leave.backToInbox")}
            </Button>

            <PageHeader
                title={t("leave.requestDetailsTitle", { id: request.id })}
                tags={<Tag color={statusColor()}>{statusLabel}</Tag>}
            />

            <Card style={{ borderRadius: 16 }} title={t("common.details")}>
                <Descriptions bordered column={1}>
                    <Descriptions.Item label={t("common.employee")}>{request.employee?.full_name || `ID: ${request.employee?.id}`}</Descriptions.Item>
                    <Descriptions.Item label={t("leave.type")}>{translateLeaveType(request.leave_type?.name)}</Descriptions.Item>
                    <Descriptions.Item label={t("leave.period")}>{request.start_date} {t("common.to")} {request.end_date}</Descriptions.Item>
                    <Descriptions.Item label={t("common.duration")}>{request.days} {t("leaves.days")}</Descriptions.Item>
                    <Descriptions.Item label={t("common.reason")}>{request.reason}</Descriptions.Item>
                    <Descriptions.Item label={t("common.document")}>
                        {request.document ? (
                            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                                <Button icon={<EyeOutlined />} onClick={() => openDocument(false)} loading={documentLoading}>
                                    {t("common.preview")}
                                </Button>
                                <Button icon={<DownloadOutlined />} onClick={() => openDocument(true)} loading={documentLoading}>
                                    {t("common.download")}
                                </Button>
                            </div>
                        ) : (
                            "-"
                        )}
                    </Descriptions.Item>
                    <Descriptions.Item label={t("common.submittedOn")}>{request.created_at ? new Date(request.created_at).toLocaleDateString() : '-'}</Descriptions.Item>
                    {request.source === "hr_manual" && (
                        <Descriptions.Item label={t("leave.manual.recordSource")}>
                            <Tag color="cyan">{t("leave.manual.badge")}</Tag>
                        </Descriptions.Item>
                    )}
                    {request.source === "hr_manual" && (
                        <Descriptions.Item label={t("leave.manual.entryReason")}>{request.manual_entry_reason || "-"}</Descriptions.Item>
                    )}
                    {request.source === "hr_manual" && (
                        <Descriptions.Item label={t("leave.manual.sourceDocumentRef")}>{request.source_document_ref || "-"}</Descriptions.Item>
                    )}

                    {request.status === 'rejected' && (
                        <Descriptions.Item label={t("leave.rejectionReason")} contentStyle={{ color: 'red' }}>
                            {request.ceo_decision_note || request.hr_decision_note || request.manager_decision_note || request.rejection_reason || '-'}
                        </Descriptions.Item>
                    )}
                    {request.status === 'pending_ceo' && (
                        <Descriptions.Item label={t("leave.statusNote")} contentStyle={{ color: '#d4380d' }}>
                            {t("leave.ceoApprovalWait")}
                        </Descriptions.Item>
                    )}
                </Descriptions>

                {canAction && (
                    <>
                        <Divider />
                        <div style={{ display: 'flex', gap: 16, justifyContent: 'flex-end' }}>
                            {canSendToCEO && (
                                <Button
                                    icon={<ExportOutlined />}
                                    onClick={handleSendToCEO}
                                    disabled={processing}
                                >
                                    {t("leave.sendToCeoBtn")}
                                </Button>
                            )}
                            <Button
                                danger
                                icon={<CloseCircleOutlined />}
                                onClick={() => setRejectModalVisible(true)}
                                disabled={processing}
                            >
                                {t("leave.reject")}
                            </Button>
                            <Button
                                type="primary"
                                icon={<CheckCircleOutlined />}
                                onClick={handleApprove}
                                loading={processing}
                            >
                                {t("leave.approve")}
                            </Button>
                        </div>
                    </>
                )}
            </Card>

            {/* Reject Modal */}
            <Modal
                title={t("leave.rejectTitle")}
                open={rejectModalVisible}
                onOk={handleReject}
                onCancel={() => setRejectModalVisible(false)}
                okText={t("leave.rejectBtn")}
                okType="danger"
                confirmLoading={processing}
            >
                <Alert
                    type="warning"
                    message={t("leave.rejectWarning")}
                    showIcon
                    style={{ marginBottom: 16 }}
                />
                <TextArea
                    rows={4}
                    placeholder={t("leave.rejectPlaceholder")}
                    value={rejectionReason}
                    onChange={e => setRejectionReason(e.target.value)}
                />
            </Modal>
        </div>
    );
}
