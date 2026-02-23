import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Alert, Button, Card, Descriptions, Input, Modal, Tag, notification } from "antd";
import {
    ArrowLeftOutlined,
    CheckCircleOutlined,
    CloseCircleOutlined,
    DownloadOutlined,
    EyeOutlined,
} from "@ant-design/icons";

import PageHeader from "../../components/ui/PageHeader";
import LoadingState from "../../components/ui/LoadingState";
import ErrorState from "../../components/ui/ErrorState";
import { isApiError } from "../../services/api/apiTypes";
import {
    approveLeaveRequestManager,
    getManagerLeaveRequest,
    getManagerLeaveRequestDocumentBlob,
    rejectLeaveRequestManager,
    type ManagerLeaveRequest,
} from "../../services/api/managerApi";

const { confirm } = Modal;
const { TextArea } = Input;

export default function ManagerLeaveRequestDetailsPage() {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();

    const [loading, setLoading] = useState(true);
    const [request, setRequest] = useState<ManagerLeaveRequest | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [processing, setProcessing] = useState(false);
    const [documentLoading, setDocumentLoading] = useState(false);
    const [rejectModalVisible, setRejectModalVisible] = useState(false);
    const [rejectionReason, setRejectionReason] = useState("");

    const loadData = useCallback(async () => {
        if (!id) return;
        setLoading(true);
        try {
            const res = await getManagerLeaveRequest(id);
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

    const canAction = request?.status?.toLowerCase() === "submitted" || request?.status?.toLowerCase() === "pending_manager";

    const handleApprove = () => {
        if (!request) return;
        confirm({
            title: "Approve Leave Request",
            content: `Approve leave for ${request.employee?.full_name || request.employee?.email}?`,
            okText: "Approve",
            cancelText: "Cancel",
            onOk: async () => {
                setProcessing(true);
                try {
                    const res = await approveLeaveRequestManager(request.id);
                    if (isApiError(res)) {
                        notification.error({ message: "Approval Failed", description: res.message });
                    } else {
                        notification.success({ message: "Request Approved" });
                        loadData();
                    }
                } catch {
                    notification.error({ message: "Error", description: "System error during approval" });
                } finally {
                    setProcessing(false);
                }
            },
        });
    };

    const handleReject = async () => {
        if (!request || !rejectionReason.trim()) {
            notification.error({ message: "Reason Required", description: "Please provide a reason for rejection." });
            return;
        }
        setProcessing(true);
        try {
            const res = await rejectLeaveRequestManager(request.id, rejectionReason);
            if (isApiError(res)) {
                notification.error({ message: "Rejection Failed", description: res.message });
            } else {
                notification.success({ message: "Request Rejected" });
                setRejectModalVisible(false);
                setRejectionReason("");
                loadData();
            }
        } catch {
            notification.error({ message: "Error", description: "System error during rejection" });
        } finally {
            setProcessing(false);
        }
    };

    const openDocument = async (download: boolean) => {
        if (!request) return;
        setDocumentLoading(true);
        try {
            const blob = await getManagerLeaveRequestDocumentBlob(request.id, download);
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

    if (loading) return <LoadingState title="Loading request details..." />;
    if (error) return <ErrorState title="Error" description={error} onRetry={loadData} />;
    if (!request) return <ErrorState title="Not Found" description="Leave request not found." />;

    return (
        <div style={{ maxWidth: 800, margin: "0 auto" }}>
            <Button
                type="link"
                icon={<ArrowLeftOutlined />}
                onClick={() => navigate("/manager/team-requests?tab=leave")}
                style={{ paddingLeft: 0, marginBottom: 16 }}
            >
                Back to Team Requests
            </Button>

            <PageHeader
                title={`Leave Request #${request.id}`}
                tags={
                    <Tag color={request.status?.toLowerCase() === "rejected" ? "red" : "orange"}>
                        {request.status?.replace("_", " ").toUpperCase()}
                    </Tag>
                }
            />

            <Card style={{ borderRadius: 16 }} title="Details">
                <Descriptions bordered column={1}>
                    <Descriptions.Item label="Employee">{request.employee?.full_name || request.employee?.email}</Descriptions.Item>
                    <Descriptions.Item label="Leave Type">{request.leave_type?.name}</Descriptions.Item>
                    <Descriptions.Item label="Period">{request.start_date} to {request.end_date}</Descriptions.Item>
                    <Descriptions.Item label="Reason">{request.reason || "-"}</Descriptions.Item>
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
                </Descriptions>

                {canAction && (
                    <div style={{ marginTop: 16, display: "flex", gap: 12, justifyContent: "flex-end" }}>
                        <Button
                            danger
                            icon={<CloseCircleOutlined />}
                            onClick={() => setRejectModalVisible(true)}
                            disabled={processing}
                        >
                            Reject
                        </Button>
                        <Button type="primary" icon={<CheckCircleOutlined />} onClick={handleApprove} loading={processing}>
                            Approve
                        </Button>
                    </div>
                )}
            </Card>

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
                    onChange={(e) => setRejectionReason(e.target.value)}
                />
            </Modal>
        </div>
    );
}
