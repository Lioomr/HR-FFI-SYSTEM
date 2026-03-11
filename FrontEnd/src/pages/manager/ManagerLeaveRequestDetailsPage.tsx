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
import { useI18n } from "../../i18n/useI18n";
import {
    approveLeaveRequestManager,
    getManagerLeaveRequest,
    getManagerLeaveRequestDocumentBlob,
    rejectLeaveRequestManager,
    type ManagerLeaveRequest,
} from "../../services/api/managerApi";
import LeaveApprovalMap from "../../components/leaves/LeaveApprovalMap";

const { confirm } = Modal;
const { TextArea } = Input;

export default function ManagerLeaveRequestDetailsPage() {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const { t } = useI18n();

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
            setError(e.message || t("leave.loadFail"));
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
            title: t("leave.approveTitle"),
            content: t("leave.approveConfirmDesc", { name: request.employee?.full_name || request.employee?.email || "" }),
            okText: t("common.approve"),
            cancelText: t("common.cancel"),
            onOk: async () => {
                setProcessing(true);
                try {
                    const res = await approveLeaveRequestManager(request.id);
                    if (isApiError(res)) {
                        notification.error({ message: t("leave.approveFail"), description: res.message });
                    } else {
                        notification.success({ message: t("leave.approveSuccess") });
                        loadData();
                    }
                } catch {
                    notification.error({ message: t("common.error"), description: t("leave.approveError") });
                } finally {
                    setProcessing(false);
                }
            },
        });
    };

    const handleReject = async () => {
        if (!request || !rejectionReason.trim()) {
            notification.error({ message: t("leave.reasonReqTitle"), description: t("leave.reasonReqDesc") });
            return;
        }
        setProcessing(true);
        try {
            const res = await rejectLeaveRequestManager(request.id, rejectionReason);
            if (isApiError(res)) {
                notification.error({ message: t("leave.rejectFail"), description: res.message });
            } else {
                notification.success({ message: t("leave.rejectSuccess") });
                setRejectModalVisible(false);
                setRejectionReason("");
                loadData();
            }
        } catch {
            notification.error({ message: t("common.error"), description: t("leave.rejectError") });
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
            notification.error({ message: t("leave.docErrorTitle"), description: t("leave.docErrorDesc") });
        } finally {
            setDocumentLoading(false);
        }
    };

    if (loading) return <LoadingState title={t("leave.loadingDetails")} />;
    if (error) return <ErrorState title={t("common.error")} description={error} onRetry={loadData} />;
    if (!request) return <ErrorState title={t("leave.notFound")} description={t("leave.notFoundDesc")} />;

    return (
        <div style={{ maxWidth: 800, margin: "0 auto" }}>
            <Button
                type="link"
                icon={<ArrowLeftOutlined />}
                onClick={() => navigate("/manager/team-requests?tab=leave")}
                style={{ paddingLeft: 0, marginBottom: 16 }}
            >
                {t("leave.backToTeamReqs")}
            </Button>

            <PageHeader
                title={t("leave.requestDetailsTitle", { id: request.id })}
                tags={
                    <Tag color={request.status?.toLowerCase() === "rejected" ? "red" : "orange"}>
                        {request.status?.replace("_", " ").toUpperCase()}
                    </Tag>
                }
            />

            <div style={{ display: "grid", gap: 18 }}>
            <LeaveApprovalMap request={request as any} t={t} />

            <Card style={{ borderRadius: 16 }} title={t("common.details")}>
                <Descriptions bordered column={1}>
                    <Descriptions.Item label={t("common.employee")}>{request.employee?.full_name || request.employee?.email}</Descriptions.Item>
                    <Descriptions.Item label={t("leave.type")}>{request.leave_type?.name}</Descriptions.Item>
                    <Descriptions.Item label={t("leave.period")}>{request.start_date} {t("common.to")} {request.end_date}</Descriptions.Item>
                    <Descriptions.Item label={t("common.reason")}>{request.reason || "-"}</Descriptions.Item>
                    <Descriptions.Item label={t("common.document")}>
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
            </div>

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
                    onChange={(e) => setRejectionReason(e.target.value)}
                />
            </Modal>
        </div>
    );
}
