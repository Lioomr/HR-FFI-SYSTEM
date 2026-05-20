import { useCallback, useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Button, Card, Descriptions, Divider, Alert, Tag, Modal, Input, Upload, Space, Table, Typography, notification } from "antd";
import { ArrowLeftOutlined, CheckCircleOutlined, CloseCircleOutlined, EyeOutlined, DownloadOutlined, ExportOutlined, FilePdfOutlined, CheckOutlined } from "@ant-design/icons";
import type { UploadFile } from "antd/es/upload/interface";

import PageHeader from "../../../components/ui/PageHeader";
import LoadingState from "../../../components/ui/LoadingState";
import ErrorState from "../../../components/ui/ErrorState";
import { getLeaveRequest, approveLeaveRequest, rejectLeaveRequest, sendLeaveRequestToCEO, completeLeaveRequest, getLeaveRequestDocumentBlob, type LeaveRequest } from "../../../services/api/leaveApi";
import { downloadEmployeeDocument } from "../../../services/api/employeesApi";
import { isApiError } from "../../../services/api/apiTypes";
import { useI18n } from "../../../i18n/useI18n";
import LeaveApprovalMap from "../../../components/leaves/LeaveApprovalMap";
import RequestObligationsPanel from "../../../components/requests/RequestObligationsPanel";
import { formatDateTime } from "../../../utils/dateTime";

const { confirm } = Modal;
const { TextArea } = Input;
const { Text } = Typography;

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

    // Visa download state
    const [visaDownloadingId, setVisaDownloadingId] = useState<number | null>(null);

    // HR Completion States
    const [completeComment, setCompleteComment] = useState("");
    const [visaFile, setVisaFile] = useState<File | null>(null);
    const [visaFileList, setVisaFileList] = useState<UploadFile[]>([]);
    const [extractionWarnings, setExtractionWarnings] = useState<string[]>([]);

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
    }, [id, t]);

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
                } catch {
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
                } catch (e: any) {
                    notification.error({ message: t("common.error"), description: e?.message || t("leave.sendError") });
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

    const handleVisaDownload = async (docId: number, filename?: string) => {
        if (!request?.employee?.id) return;
        setVisaDownloadingId(docId);
        try {
            const blob = await downloadEmployeeDocument(request.employee.id, docId);
            const url = window.URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.href = url;
            link.download = filename || `visa_${docId}`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            setTimeout(() => window.URL.revokeObjectURL(url), 5000);
        } catch {
            notification.error({ message: t("common.error"), description: t("common.tryAgain") });
        } finally {
            setVisaDownloadingId(null);
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
        } catch {
            notification.error({ message: t("common.error"), description: t("leave.rejectError") });
        } finally {
            setProcessing(false);
        }
    };

    const handleComplete = async () => {
        if (!request) return;
        if (request.requires_hr_completion_visa && !visaFile) {
            notification.error({ message: t("leave.visaRequired", "Visa document is required for non-Saudi employees.") });
            return;
        }
        setProcessing(true);
        try {
            const res = await completeLeaveRequest(request.id, {
                comment: completeComment.trim() || undefined,
                visa_document: visaFile ?? undefined,
            });
            if (isApiError(res)) {
                notification.error({ message: t("leave.completeFail", "Completion failed"), description: res.message });
            } else {
                const warnings: string[] = (res as any).data?.extraction_warnings ?? [];
                if (warnings.length > 0) setExtractionWarnings(warnings);
                notification.success({ message: t("leave.completeSuccess", "Leave request completed and approved.") });
                setCompleteComment("");
                setVisaFile(null);
                setVisaFileList([]);
                loadData();
            }
        } catch (e: any) {
            notification.error({ message: t("common.error"), description: e?.message });
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
    const canComplete = request.status?.toLowerCase() === 'pending_hr_completion';

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
        if (s === 'pending_hr_completion') return 'cyan';
        if (s === 'pending_delegate') return 'gold';
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

            <div style={{ display: "grid", gap: 18 }}>
            <LeaveApprovalMap request={request} t={t} />
            <RequestObligationsPanel parentType="leave_request" parentId={request.id} leaveRequest={request} onChanged={loadData} />

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
                    <Descriptions.Item label={t("common.submittedOn")}>{formatDateTime(request.created_at)}</Descriptions.Item>
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
                            {request.ceo_decision_note || request.hr_decision_note || request.manager_decision_note || request.delegate_decision_note || request.rejection_reason || '-'}
                        </Descriptions.Item>
                    )}
                    {request.status === 'pending_ceo' && (
                        <Descriptions.Item label={t("leave.statusNote")} contentStyle={{ color: '#d4380d' }}>
                            {t("leave.ceoApprovalWait")}
                        </Descriptions.Item>
                    )}
                    {request.status === 'pending_hr_completion' && (
                        <Descriptions.Item label={t("leave.statusNote")} contentStyle={{ color: '#08979c' }}>
                            {t("leave.hrCompletionWait", "CEO has approved. HR must complete the request to finalize.")}
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

                {canComplete && (
                    <>
                        <Divider />
                        <div>
                            <Alert
                                type="info"
                                showIcon
                                message={t("leave.hrCompletionRequired", "HR Completion Required")}
                                description={t("leave.hrCompletionDesc", "CEO has approved this request. Complete it below to finalize.")}
                                style={{ marginBottom: 16 }}
                            />
                            {extractionWarnings.length > 0 && (
                                <Alert
                                    type="warning"
                                    showIcon
                                    message={t("leave.extractionWarnings", "Extraction Warnings")}
                                    description={<ul style={{ margin: 0, paddingLeft: 16 }}>{extractionWarnings.map((w, i) => <li key={i}>{w}</li>)}</ul>}
                                    style={{ marginBottom: 16 }}
                                    closable
                                    onClose={() => setExtractionWarnings([])}
                                />
                            )}
                            <Space direction="vertical" style={{ width: '100%' }} size={12}>
                                {request.requires_hr_completion_visa && (
                                    <div>
                                        <div style={{ marginBottom: 6, fontWeight: 500 }}>
                                            {t("leave.visaDocument", "Visa Document (PDF)")}
                                            <span style={{ color: '#ff4d4f', marginLeft: 4 }}>*</span>
                                        </div>
                                        <Upload
                                            accept=".pdf,.PDF"
                                            maxCount={1}
                                            fileList={visaFileList}
                                            beforeUpload={(file) => {
                                                setVisaFile(file);
                                                setVisaFileList([{ uid: file.uid || '-1', name: file.name, status: 'done' }]);
                                                return false;
                                            }}
                                            onRemove={() => { setVisaFile(null); setVisaFileList([]); }}
                                        >
                                            <Button icon={<FilePdfOutlined />}>
                                                {t("leave.selectVisaPdf", "Select Visa PDF")}
                                            </Button>
                                        </Upload>
                                    </div>
                                )}
                                {!request.requires_hr_completion_visa && (
                                    <div>
                                        <div style={{ marginBottom: 6, fontWeight: 500 }}>
                                            {t("leave.visaDocumentOptional", "Visa Document (optional)")}
                                        </div>
                                        <Upload
                                            accept=".pdf,.PDF"
                                            maxCount={1}
                                            fileList={visaFileList}
                                            beforeUpload={(file) => {
                                                setVisaFile(file);
                                                setVisaFileList([{ uid: file.uid || '-1', name: file.name, status: 'done' }]);
                                                return false;
                                            }}
                                            onRemove={() => { setVisaFile(null); setVisaFileList([]); }}
                                        >
                                            <Button icon={<FilePdfOutlined />}>
                                                {t("leave.selectVisaPdf", "Select Visa PDF")}
                                            </Button>
                                        </Upload>
                                    </div>
                                )}
                                <Input.TextArea
                                    rows={3}
                                    placeholder={t("leave.completionComment", "Optional comment...")}
                                    value={completeComment}
                                    onChange={e => setCompleteComment(e.target.value)}
                                />
                                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                                    <Button
                                        type="primary"
                                        icon={<CheckOutlined />}
                                        loading={processing}
                                        onClick={handleComplete}
                                    >
                                        {t("leave.completeBtn", "Complete & Approve")}
                                    </Button>
                                </div>
                            </Space>
                        </div>
                    </>
                )}
            </Card>

            {/* Visa Details Card */}
            {(() => {
                const allDocs = request.employee_documents ?? [];
                const visaDocs = allDocs
                    .filter(d => d.document_type === "VISA")
                    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

                return (
                    <Card
                        style={{ borderRadius: 16 }}
                        title={t("leave.visaDetails", "Visa Details")}
                    >
                        {visaDocs.length === 0 ? (
                            <Alert
                                type={request.status === "pending_hr_completion" ? "warning" : "info"}
                                showIcon
                                message={
                                    request.status === "pending_hr_completion"
                                        ? t("leave.noVisaUploaded", "No visa document uploaded yet.")
                                        : t("leave.noVisaForRequest", "No visa document is associated with this leave request.")
                                }
                            />
                        ) : (
                            <Table
                                dataSource={visaDocs}
                                rowKey="id"
                                size="small"
                                pagination={false}
                                columns={[
                                    {
                                        title: t("leave.visaNumber", "Visa No."),
                                        dataIndex: "visa_number",
                                        render: (v: string) => v || <Text type="secondary">—</Text>,
                                    },
                                    {
                                        title: t("leave.exitBefore", "Exit Before"),
                                        dataIndex: "exit_before",
                                        render: (v: string) => v ? String(v).split("T")[0] : <Text type="secondary">—</Text>,
                                    },
                                    {
                                        title: t("leave.visaDuration", "Duration"),
                                        dataIndex: "visa_duration",
                                        render: (v: string) => v || <Text type="secondary">—</Text>,
                                    },
                                    {
                                        title: t("leave.extractionStatus", "Extraction"),
                                        dataIndex: "extraction_status",
                                        render: (v: string) => {
                                            const color: Record<string, string> = { pending: "default", success: "success", partial: "warning", failed: "error" };
                                            return <Tag color={color[v] ?? "default"}>{v ? v.charAt(0).toUpperCase() + v.slice(1) : "—"}</Tag>;
                                        },
                                    },
                                    {
                                        title: t("archive.uploadedBy", "Uploaded By"),
                                        dataIndex: "uploaded_by_name",
                                        render: (v: string) => v || <Text type="secondary">—</Text>,
                                    },
                                    {
                                        title: t("archive.uploadedAt", "Date"),
                                        dataIndex: "created_at",
                                        render: (v: string) => v ? String(v).split("T")[0] : "—",
                                    },
                                    {
                                        title: t("common.actions"),
                                        key: "actions",
                                        render: (_: unknown, r) => (
                                            <Button
                                                size="small"
                                                icon={<DownloadOutlined />}
                                                loading={visaDownloadingId === r.id}
                                                onClick={() => handleVisaDownload(r.id, r.original_filename)}
                                            >
                                                {t("common.download")}
                                            </Button>
                                        ),
                                    },
                                ]}
                            />
                        )}
                    </Card>
                );
            })()}
            </div>

            {/* Reject Modal */}
            <Modal
                title={t("leave.rejectTitle")}
                open={rejectModalVisible}
                onOk={handleReject}
                onCancel={() => setRejectModalVisible(false)}
                okText={t("leave.rejectBtn")}
                okType="danger"
                confirmLoading={processing}
                width="min(520px, 96vw)"
                style={{ top: 16 }}
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
