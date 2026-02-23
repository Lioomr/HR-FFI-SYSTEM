import { useCallback, useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Button, Card, Descriptions, Divider, Alert, Tag, Modal, Input, notification } from "antd";
import { ArrowLeftOutlined, CheckCircleOutlined, CloseCircleOutlined, EyeOutlined, DownloadOutlined, ExportOutlined } from "@ant-design/icons";

import PageHeader from "../../../components/ui/PageHeader";
import LoadingState from "../../../components/ui/LoadingState";
import ErrorState from "../../../components/ui/ErrorState";
import { getLeaveRequest, approveLeaveRequest, rejectLeaveRequest, sendLeaveRequestToCEO, getLeaveRequestDocumentBlob, type LeaveRequest } from "../../../services/api/leaveApi";
import { isApiError } from "../../../services/api/apiTypes";

const { confirm } = Modal;
const { TextArea } = Input;

export default function LeaveRequestDetailsPage() {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();

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
            setError(e.message || "Failed to load request details");
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
            title: "Approve Leave Request",
            content: `Approve leave for ${request.employee?.full_name} (${request.days} days)?`,
            okText: "Approve",
            okType: "primary",
            cancelText: "Cancel",
            onOk: async () => {
                setProcessing(true);
                try {
                    const res = await approveLeaveRequest(request.id);
                    if (isApiError(res)) {
                        notification.error({ message: "Approval Failed", description: res.message });
                    } else {
                        notification.success({ message: "Request Approved" });
                        loadData();
                    }
                } catch (e) {
                    notification.error({ message: "Error", description: "System error during approval" });
                } finally {
                    setProcessing(false);
                }
            }
        });
    };

    const handleSendToCEO = () => {
        if (!request) return;
        confirm({
            title: "Send Request to CEO",
            content: "This will move the request to CEO inbox for review and final handling.",
            okText: "Send to CEO",
            okType: "primary",
            cancelText: "Cancel",
            onOk: async () => {
                setProcessing(true);
                try {
                    const res = await sendLeaveRequestToCEO(request.id);
                    if (isApiError(res)) {
                        notification.error({ message: "Send Failed", description: res.message });
                    } else {
                        notification.success({ message: "Request sent to CEO" });
                        loadData();
                    }
                } catch {
                    notification.error({ message: "Error", description: "System error while sending to CEO" });
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
            notification.error({ message: "Document Error", description: "Unable to open document." });
        } finally {
            setDocumentLoading(false);
        }
    };

    const handleReject = async () => {
        if (!request || !rejectionReason.trim()) {
            notification.error({ message: "Reason Required", description: "Please provide a reason for rejection." });
            return;
        }

        setProcessing(true);
        try {
            const res = await rejectLeaveRequest(request.id, rejectionReason);
            if (isApiError(res)) {
                notification.error({ message: "Rejection Failed", description: res.message });
            } else {
                notification.success({ message: "Request Rejected" });
                setRejectModalVisible(false);
                setRejectionReason("");
                loadData();
            }
        } catch (e) {
            notification.error({ message: "Error", description: "System error during rejection" });
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

    const statusLabel = (request.status || '')
        .replace(/_/g, ' ')
        .replace(/\b\w/g, (c) => c.toUpperCase());

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
                Back to Inbox
            </Button>

            <PageHeader
                title={`Leave Request #${request.id}`}
                tags={<Tag color={statusColor()}>{statusLabel}</Tag>}
            />

            <Card style={{ borderRadius: 16 }} title="Details">
                <Descriptions bordered column={1}>
                    <Descriptions.Item label="Employee">{request.employee?.full_name || `ID: ${request.employee?.id}`}</Descriptions.Item>
                    <Descriptions.Item label="Leave Type">{request.leave_type?.name}</Descriptions.Item>
                    <Descriptions.Item label="Period">{request.start_date} to {request.end_date}</Descriptions.Item>
                    <Descriptions.Item label="Duration">{request.days} Days</Descriptions.Item>
                    <Descriptions.Item label="Reason">{request.reason}</Descriptions.Item>
                    <Descriptions.Item label="Document">
                        {request.document ? (
                            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                                <Button icon={<EyeOutlined />} onClick={() => openDocument(false)} loading={documentLoading}>
                                    Preview
                                </Button>
                                <Button icon={<DownloadOutlined />} onClick={() => openDocument(true)} loading={documentLoading}>
                                    Download
                                </Button>
                            </div>
                        ) : (
                            "-"
                        )}
                    </Descriptions.Item>
                    <Descriptions.Item label="Submitted On">{request.created_at ? new Date(request.created_at).toLocaleDateString() : '-'}</Descriptions.Item>

                    {request.status === 'rejected' && (
                        <Descriptions.Item label="Rejection Reason" contentStyle={{ color: 'red' }}>
                            {request.ceo_decision_note || request.hr_decision_note || request.manager_decision_note || request.rejection_reason || '-'}
                        </Descriptions.Item>
                    )}
                    {request.status === 'pending_ceo' && (
                        <Descriptions.Item label="Status Note" contentStyle={{ color: '#d4380d' }}>
                            This request is awaiting CEO approval. No further HR action required.
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
                                    Send to CEO
                                </Button>
                            )}
                            <Button
                                danger
                                icon={<CloseCircleOutlined />}
                                onClick={() => setRejectModalVisible(true)}
                                disabled={processing}
                            >
                                Reject
                            </Button>
                            <Button
                                type="primary"
                                icon={<CheckCircleOutlined />}
                                onClick={handleApprove}
                                loading={processing}
                            >
                                Approve
                            </Button>
                        </div>
                    </>
                )}
            </Card>

            {/* Reject Modal */}
            <Modal
                title="Reject Leave Request"
                open={rejectModalVisible}
                onOk={handleReject}
                onCancel={() => setRejectModalVisible(false)}
                okText="Reject Request"
                okType="danger"
                confirmLoading={processing}
            >
                <Alert
                    type="warning"
                    message="This action is irreversible. Please provide a reason to the employee."
                    showIcon
                    style={{ marginBottom: 16 }}
                />
                <TextArea
                    rows={4}
                    placeholder="Reason for rejection..."
                    value={rejectionReason}
                    onChange={e => setRejectionReason(e.target.value)}
                />
            </Modal>
        </div>
    );
}
