import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Alert, Button, Col, Grid, Modal, Row, Space, Typography, notification } from "antd";
import {
    ArrowLeftOutlined,
    ArrowRightOutlined,
    CalendarOutlined,
    DownloadOutlined,
    EyeOutlined,
    FilePdfOutlined,
    ReloadOutlined,
} from "@ant-design/icons";

import PageHeader from "../../components/ui/PageHeader";
import LoadingState from "../../components/ui/LoadingState";
import ErrorState from "../../components/ui/ErrorState";
import EmptyState from "../../components/ui/EmptyState";
import DashboardPanel from "../../components/hr/dashboard/DashboardPanel";
import ApprovalActions from "../../components/ceo/ApprovalActions";
import ApprovalStatusTag from "../../components/ceo/ApprovalStatusTag";
import RejectReasonModal from "../../components/ceo/RejectReasonModal";
import { approvalStatusLabel } from "../../components/ceo/approvalStatusLabel";
import TeamMemberCell from "../../components/manager/TeamMemberCell";
import LeaveApprovalMap from "../../components/leaves/LeaveApprovalMap";
import RequestObligationsPanel from "../../components/requests/RequestObligationsPanel";
import { isApiError } from "../../services/api/apiTypes";
import { isForbidden, isNotFound } from "../../services/api/httpErrors";
import { requestAgeLabel } from "../../utils/requestAge";
import { useI18n } from "../../i18n/useI18n";
import {
    approveLeaveRequestManager,
    getManagerLeaveRequest,
    getManagerLeaveRequestDocumentBlob,
    getManagerLeaveRequestPdfBlob,
    rejectLeaveRequestManager,
    type ManagerLeaveRequest,
} from "../../services/api/managerApi";

const { useBreakpoint } = Grid;
const BACK_PATH = "/manager/team-requests?tab=leave";

/** Statuses where the manager is still the deciding approver. */
const ACTIONABLE = new Set(["pending_manager", "submitted"]);

/** One labelled fact inside a detail panel. */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div style={{ minWidth: 0 }}>
            <div
                style={{
                    fontSize: 11.5,
                    fontWeight: 700,
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                    color: "#94a3b8",
                    marginBottom: 4,
                }}
            >
                {label}
            </div>
            <div style={{ fontSize: 14, color: "#0f172a", overflowWrap: "anywhere" }}>{children}</div>
        </div>
    );
}

export default function ManagerLeaveRequestDetailsPage() {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const { t, language } = useI18n();
    const screens = useBreakpoint();
    const isMobile = !screens.md;
    const isRtl = language === "ar";

    const [loading, setLoading] = useState(true);
    const [request, setRequest] = useState<ManagerLeaveRequest | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [forbidden, setForbidden] = useState(false);
    const [processing, setProcessing] = useState(false);
    const [documentLoading, setDocumentLoading] = useState(false);
    const [pdfLoading, setPdfLoading] = useState(false);
    const [confirmingApprove, setConfirmingApprove] = useState(false);
    const [rejectOpen, setRejectOpen] = useState(false);

    const loadData = useCallback(async () => {
        if (!id) return;
        setLoading(true);
        setForbidden(false);
        try {
            const res = await getManagerLeaveRequest(id);
            if (isApiError(res)) {
                setError(res.message);
            } else {
                setRequest(res.data);
            }
        } catch (e: any) {
            // 403/404 here means the request belongs to someone outside the
            // approver's team, which is different from a load failure.
            if (isForbidden(e) || isNotFound(e)) {
                setForbidden(true);
            } else {
                setError(e.message || t("leave.loadFail"));
            }
        } finally {
            setLoading(false);
        }
    }, [id, t]);

    useEffect(() => {
        void loadData();
    }, [loadData]);

    // The backend remains authoritative; this only hides controls that would be
    // rejected anyway.
    const canAction = ACTIONABLE.has(String(request?.status || "").toLowerCase());

    const employeeName =
        request?.employee?.full_name || request?.employee?.email || t("manager.requests.unknown");

    const submitApprove = async () => {
        if (!request) return;
        setProcessing(true);
        try {
            const res = await approveLeaveRequestManager(request.id);
            if (isApiError(res)) {
                notification.error({ message: t("leave.approveFail"), description: res.message });
                return;
            }
            notification.success({ message: t("leave.approveSuccess") });
            setConfirmingApprove(false);
            await loadData();
        } catch {
            notification.error({ message: t("common.error"), description: t("leave.approveError") });
        } finally {
            setProcessing(false);
        }
    };

    const submitReject = async (reason: string) => {
        if (!request) return;
        setProcessing(true);
        try {
            const res = await rejectLeaveRequestManager(request.id, reason);
            if (isApiError(res)) {
                notification.error({ message: t("leave.rejectFail"), description: res.message });
                return;
            }
            notification.success({ message: t("leave.rejectSuccess") });
            setRejectOpen(false);
            await loadData();
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

    const downloadPdf = async () => {
        if (!request) return;
        setPdfLoading(true);
        try {
            const blob = await getManagerLeaveRequestPdfBlob(request.id, true);
            const url = window.URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.href = url;
            link.download = `leave_request_${request.id}.pdf`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            setTimeout(() => window.URL.revokeObjectURL(url), 5000);
        } catch {
            notification.error({ message: t("common.error"), description: t("leave.pdfDownloadFailed") });
        } finally {
            setPdfLoading(false);
        }
    };

    if (loading) return <LoadingState title={t("leave.loadingDetails")} />;
    if (forbidden) {
        return (
            <EmptyState
                title={t("manager.empty.noRequestPermissionTitle")}
                description={t("manager.empty.noRequestPermissionDesc")}
                actionText={t("leave.backToTeamReqs")}
                onAction={() => navigate(BACK_PATH)}
            />
        );
    }
    if (error) return <ErrorState title={t("common.error")} description={error} onRetry={loadData} />;
    if (!request) return <ErrorState title={t("leave.notFound")} description={t("leave.notFoundDesc")} />;

    const gutter: [number, number] = isMobile ? [12, 12] : [20, 20];

    return (
        <div style={{ maxWidth: 1600, margin: "0 auto", paddingBottom: 24 }}>
            <Button
                type="link"
                icon={isRtl ? <ArrowRightOutlined aria-hidden /> : <ArrowLeftOutlined aria-hidden />}
                onClick={() => navigate(BACK_PATH)}
                style={{ paddingInlineStart: 0, marginBottom: 8, fontWeight: 600 }}
            >
                {t("leave.backToTeamReqs")}
            </Button>

            <PageHeader
                title={t("leave.requestDetailsTitle", { id: request.id })}
                subtitle={employeeName}
                secondarySubtitle={requestAgeLabel(t, request.created_at)}
                tags={
                    <ApprovalStatusTag
                        label={approvalStatusLabel(request.status, t)}
                        status={request.status}
                    />
                }
                actions={
                    <Space size={8} wrap>
                        <Button
                            icon={<FilePdfOutlined aria-hidden />}
                            onClick={downloadPdf}
                            loading={pdfLoading}
                            style={{ borderRadius: 10, minHeight: 40 }}
                        >
                            {t("leave.downloadRequestPdf")}
                        </Button>
                        <Button
                            icon={<ReloadOutlined aria-hidden />}
                            onClick={loadData}
                            aria-label={t("common.refresh")}
                            style={{ borderRadius: 10, minHeight: 40 }}
                        >
                            {t("common.refresh")}
                        </Button>
                    </Space>
                }
            />

            <Row gutter={gutter} align="top">
                <Col xs={24} lg={14}>
                    <Space direction="vertical" size={isMobile ? 12 : 20} style={{ width: "100%" }}>
                        <DashboardPanel
                            title={t("manager.leaveDetails.employeeSection")}
                            animDelay={0}
                        >
                            <TeamMemberCell
                                name={employeeName}
                                secondary={request.employee?.email}
                                size={44}
                            />
                        </DashboardPanel>

                        <DashboardPanel title={t("manager.leaveDetails.requestSection")} animDelay={60}>
                            <div
                                style={{
                                    display: "grid",
                                    gridTemplateColumns: isMobile
                                        ? "1fr"
                                        : "repeat(auto-fit, minmax(180px, 1fr))",
                                    gap: 18,
                                }}
                            >
                                <Field label={t("leave.type")}>{request.leave_type?.name || "—"}</Field>
                                <Field label={t("leave.period")}>
                                    <span className="tabular-nums">
                                        <CalendarOutlined aria-hidden style={{ color: "#94a3b8", marginInlineEnd: 6 }} />
                                        {request.start_date} → {request.end_date}
                                    </span>
                                </Field>
                                <Field label={t("leave.days")}>
                                    <span className="tabular-nums">{request.days ?? "—"}</span>
                                </Field>
                                <Field label={t("common.document")}>
                                    {request.document ? (
                                        <Space size={8} wrap>
                                            <Button
                                                size="small"
                                                icon={<EyeOutlined aria-hidden />}
                                                onClick={() => openDocument(false)}
                                                loading={documentLoading}
                                                style={{ borderRadius: 8 }}
                                            >
                                                {t("common.preview")}
                                            </Button>
                                            <Button
                                                size="small"
                                                icon={<DownloadOutlined aria-hidden />}
                                                onClick={() => openDocument(true)}
                                                loading={documentLoading}
                                                style={{ borderRadius: 8 }}
                                            >
                                                {t("common.download")}
                                            </Button>
                                        </Space>
                                    ) : (
                                        <span style={{ color: "#94a3b8" }}>—</span>
                                    )}
                                </Field>
                            </div>

                            <div style={{ marginTop: 18 }}>
                                <Field label={t("common.reason")}>
                                    <Typography.Paragraph style={{ margin: 0, whiteSpace: "pre-wrap" }}>
                                        {request.reason || "—"}
                                    </Typography.Paragraph>
                                </Field>
                            </div>
                        </DashboardPanel>

                        <DashboardPanel title={t("manager.leaveDetails.decisionSection")} animDelay={120}>
                            {canAction ? (
                                <ApprovalActions
                                    size="middle"
                                    subjectLabel={employeeName}
                                    approveLoading={processing && confirmingApprove}
                                    disabled={processing}
                                    onApprove={() => setConfirmingApprove(true)}
                                    onReject={() => setRejectOpen(true)}
                                />
                            ) : (
                                <Alert
                                    type="info"
                                    showIcon
                                    style={{ borderRadius: 10 }}
                                    message={t("manager.leaveDetails.decisionClosed")}
                                />
                            )}
                        </DashboardPanel>
                    </Space>
                </Col>

                <Col xs={24} lg={10}>
                    <Space
                        direction="vertical"
                        size={isMobile ? 12 : 20}
                        style={{ width: "100%", marginTop: isMobile ? 12 : 0 }}
                    >
                        <DashboardPanel title={t("manager.leaveDetails.approvalTrail")} animDelay={160}>
                            <LeaveApprovalMap request={request as any} t={t} />
                        </DashboardPanel>

                        <RequestObligationsPanel
                            parentType="leave_request"
                            parentId={request.id}
                            leaveRequest={request as any}
                            onChanged={loadData}
                        />
                    </Space>
                </Col>
            </Row>

            <Modal
                open={confirmingApprove}
                title={t("leave.approveTitle")}
                okText={t("common.approve")}
                okButtonProps={{ loading: processing, "aria-label": t("common.approve") }}
                cancelText={t("common.cancel")}
                cancelButtonProps={{ disabled: processing }}
                onOk={submitApprove}
                onCancel={() => {
                    if (!processing) setConfirmingApprove(false);
                }}
                closable={!processing}
                maskClosable={!processing}
                destroyOnHidden
            >
                <Typography.Paragraph style={{ margin: 0 }}>
                    {t("leave.approveConfirmDesc", { name: employeeName })}
                </Typography.Paragraph>
            </Modal>

            <RejectReasonModal
                open={rejectOpen}
                title={t("leave.rejectTitle")}
                subject={employeeName}
                confirmText={t("leave.rejectBtn")}
                loading={processing}
                onCancel={() => setRejectOpen(false)}
                onSubmit={submitReject}
            />
        </div>
    );
}
