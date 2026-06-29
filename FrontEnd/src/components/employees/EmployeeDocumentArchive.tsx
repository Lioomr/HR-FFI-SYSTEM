import { useCallback, useEffect, useState } from "react";
import {
    Table, Button, Tag, Space, Upload, Select, Input, Form,
    Modal, Alert, Tooltip, notification, Typography,
} from "antd";
import {
    UploadOutlined, DownloadOutlined, ReloadOutlined, PlusOutlined, BellOutlined,
} from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";
import type { UploadFile } from "antd/es/upload/interface";
import {
    getEmployeeDocuments, uploadEmployeeDocument, downloadEmployeeDocument,
    notifyEmployeeDocumentExpiry,
    type EmployeeDocument, type DocumentType,
} from "../../services/api/employeesApi";
import { isApiError } from "../../services/api/apiTypes";
import { useI18n } from "../../i18n/useI18n";

const { Text } = Typography;

const DOCUMENT_TYPE_OPTIONS: { value: DocumentType; label: string }[] = [
    { value: "IQAMA", label: "Iqama" },
    { value: "PASSPORT", label: "Passport" },
    { value: "VISA", label: "Visa" },
    { value: "SAUDI_ID", label: "ID (Saudi Employee)" },
    { value: "OTHER", label: "Other" },
];

const extractionStatusColor: Record<string, string> = {
    pending: "default",
    success: "success",
    partial: "warning",
    failed: "error",
};

/**
 * Days until a document's expiry date (`exit_before`). Negative when expired.
 * Returns null when there is no valid expiry date.
 */
function getDaysLeft(exitBefore?: string | null): number | null {
    if (!exitBefore) return null;
    const expiry = new Date(exitBefore);
    if (Number.isNaN(expiry.getTime())) return null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    expiry.setHours(0, 0, 0, 0);
    return Math.round((expiry.getTime() - today.getTime()) / 86400000);
}

/**
 * Notify is offered only for documents that have an expiry date and are either
 * already expired or expiring within 45 days (matching backend validation).
 */
function canNotifyExpiry(exitBefore?: string | null): boolean {
    const days = getDaysLeft(exitBefore);
    return days !== null && days <= 45;
}

/** Pull a human-readable message out of an API error envelope (array or map form). */
function extractApiErrorMessage(data: any): string | null {
    if (!data) return null;
    const errs = data.errors;
    if (Array.isArray(errs) && errs.length > 0) {
        const first = errs[0];
        if (typeof first === "string") return first;
        if (first && typeof first.message === "string") return first.message;
    } else if (errs && typeof errs === "object") {
        const firstVal = Object.values(errs)[0];
        if (Array.isArray(firstVal) && firstVal.length > 0) return String(firstVal[0]);
        if (typeof firstVal === "string") return firstVal;
    }
    return typeof data.message === "string" ? data.message : null;
}

interface Props {
    employeeId: number | string;
    readonly?: boolean;
}

export default function EmployeeDocumentArchive({ employeeId, readonly = false }: Props) {
    const { t } = useI18n();
    const [docs, setDocs] = useState<EmployeeDocument[]>([]);
    const [loading, setLoading] = useState(false);
    const [uploadModalOpen, setUploadModalOpen] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [downloadingId, setDownloadingId] = useState<number | null>(null);
    const [notifyingId, setNotifyingId] = useState<number | null>(null);

    const [form] = Form.useForm();
    const [docType, setDocType] = useState<DocumentType | null>(null);
    const [fileList, setFileList] = useState<UploadFile[]>([]);
    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const [uploadWarnings, setUploadWarnings] = useState<string[]>([]);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const res = await getEmployeeDocuments(employeeId);
            if (!isApiError(res)) setDocs(res.data ?? []);
        } finally {
            setLoading(false);
        }
    }, [employeeId]);

    useEffect(() => { load(); }, [load]);

    const handleDownload = async (doc: EmployeeDocument) => {
        setDownloadingId(doc.id);
        try {
            const blob = await downloadEmployeeDocument(employeeId, doc.id);
            const url = window.URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.href = url;
            link.download = doc.original_filename || `document_${doc.id}`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            setTimeout(() => window.URL.revokeObjectURL(url), 5000);
        } catch {
            notification.error({ message: t("common.error"), description: t("common.tryAgain") });
        } finally {
            setDownloadingId(null);
        }
    };

    const handleNotify = async (doc: EmployeeDocument) => {
        setNotifyingId(doc.id);
        try {
            const res = await notifyEmployeeDocumentExpiry(employeeId, doc.id);
            if (isApiError(res)) {
                notification.warning({ message: t("archive.notifyFailed"), description: res.message });
                return;
            }
            const delivery = res.data?.delivery;
            if (delivery?.sent === true || delivery?.success === true) {
                notification.success({ message: t("archive.notifySent"), description: doc.display_name });
            } else {
                notification.warning({
                    message: t("archive.notifyFailed"),
                    description: delivery?.error || t("common.tryAgain"),
                });
            }
        } catch (e: any) {
            const validationMsg = extractApiErrorMessage(e?.response?.data);
            if (validationMsg) {
                notification.warning({ message: t("archive.notifyFailed"), description: validationMsg });
            } else {
                notification.error({ message: t("common.error"), description: e?.message || t("common.tryAgain") });
            }
        } finally {
            setNotifyingId(null);
        }
    };

    const handleUpload = async () => {
        if (!selectedFile || !docType) {
            notification.error({ message: t("common.error"), description: t("common.required") });
            return;
        }
        const values = await form.validateFields();
        setUploading(true);
        setUploadWarnings([]);
        try {
            const res = await uploadEmployeeDocument(employeeId, {
                document_type: docType,
                file: selectedFile,
                custom_name: values.custom_name,
            });
            if (isApiError(res)) {
                notification.error({ message: t("common.error"), description: res.message });
            } else {
                const warnings: string[] = (res as any).data?.extraction_warnings ?? [];
                if (warnings.length > 0) {
                    setUploadWarnings(warnings);
                } else {
                    setUploadModalOpen(false);
                    resetForm();
                }
                notification.success({ message: t("archive.uploadSuccess", "Document uploaded successfully.") });
                load();
            }
        } catch (e: any) {
            notification.error({ message: t("common.error"), description: e?.message });
        } finally {
            setUploading(false);
        }
    };

    const resetForm = () => {
        form.resetFields();
        setDocType(null);
        setFileList([]);
        setSelectedFile(null);
        setUploadWarnings([]);
    };

    const columns: ColumnsType<EmployeeDocument> = [
        {
            title: t("archive.docType", "Type"),
            key: "display_name",
            width: 140,
            render: (_, r) => <Text strong>{r.display_name}</Text>,
        },
        {
            title: t("archive.filename", "File"),
            dataIndex: "original_filename",
            key: "original_filename",
            ellipsis: true,
            render: (v) => <Text style={{ fontSize: 12 }}>{v}</Text>,
        },
        {
            title: t("archive.visaNumber", "Visa No."),
            dataIndex: "visa_number",
            key: "visa_number",
            width: 120,
            render: (v) => v || <Text type="secondary">—</Text>,
        },
        {
            title: t("archive.exitBefore", "Exit Before"),
            dataIndex: "exit_before",
            key: "exit_before",
            width: 110,
            render: (v) => v ? String(v).split("T")[0] : <Text type="secondary">—</Text>,
        },
        {
            title: t("archive.visaDuration", "Duration"),
            dataIndex: "visa_duration",
            key: "visa_duration",
            width: 90,
            render: (v) => v || <Text type="secondary">—</Text>,
        },
        {
            title: t("archive.extractionStatus", "Extraction"),
            dataIndex: "extraction_status",
            key: "extraction_status",
            width: 110,
            render: (v: string) => (
                <Tag color={extractionStatusColor[v] ?? "default"}>
                    {v.charAt(0).toUpperCase() + v.slice(1)}
                </Tag>
            ),
        },
        {
            title: t("archive.uploadedBy", "Uploaded By"),
            dataIndex: "uploaded_by_name",
            key: "uploaded_by_name",
            width: 120,
            render: (v) => v || <Text type="secondary">—</Text>,
        },
        {
            title: t("archive.uploadedAt", "Date"),
            dataIndex: "created_at",
            key: "created_at",
            width: 100,
            render: (v) => v ? String(v).split("T")[0] : "—",
        },
        {
            title: t("common.actions"),
            key: "actions",
            width: 150,
            render: (_, r) => (
                <Space size={4}>
                    <Tooltip title={t("common.download")}>
                        <Button
                            size="small"
                            icon={<DownloadOutlined />}
                            loading={downloadingId === r.id}
                            onClick={() => handleDownload(r)}
                        />
                    </Tooltip>
                    {canNotifyExpiry(r.exit_before) && (
                        <Tooltip title={t("archive.whatsappNotification")}>
                            <Button
                                size="small"
                                icon={<BellOutlined />}
                                loading={notifyingId === r.id}
                                onClick={() => handleNotify(r)}
                            >
                                {notifyingId === r.id ? t("archive.notifySending") : t("archive.notify")}
                            </Button>
                        </Tooltip>
                    )}
                </Space>
            ),
        },
    ];

    return (
        <div style={{ marginTop: 8 }}>
            <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12, gap: 8 }}>
                <Button icon={<ReloadOutlined />} onClick={load} loading={loading} size="small">
                    {t("common.refresh", "Refresh")}
                </Button>
                {!readonly && (
                    <Button
                        type="primary"
                        icon={<PlusOutlined />}
                        size="small"
                        onClick={() => { resetForm(); setUploadModalOpen(true); }}
                    >
                        {t("archive.upload", "Upload Document")}
                    </Button>
                )}
            </div>

            <Table
                dataSource={docs}
                columns={columns}
                rowKey="id"
                loading={loading}
                pagination={false}
                size="small"
                scroll={{ x: 900 }}
                locale={{ emptyText: t("archive.empty", "No documents uploaded yet.") }}
                expandable={{
                    expandedRowRender: (record) => {
                        const fields = record.extracted_fields;
                        const warnings = record.extraction_warnings ?? [];
                        return (
                            <Space direction="vertical" style={{ width: "100%", padding: "8px 0" }} size={8}>
                                {warnings.length > 0 && (
                                    <Alert
                                        type="warning"
                                        showIcon
                                        message={t("archive.extractionWarnings", "Extraction Warnings")}
                                        description={<ul style={{ margin: 0, paddingLeft: 16 }}>{warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>}
                                    />
                                )}
                                {record.extraction_error && (
                                    <Alert type="error" showIcon message={record.extraction_error} />
                                )}
                                {fields && Object.keys(fields).length > 0 && (() => {
                                    const HIDDEN_KEYS = new Set(["raw_text", "raw_data", "ocr_text", "full_text"]);
                                    const visibleEntries = Object.entries(fields).filter(
                                        ([k]) => !HIDDEN_KEYS.has(k) && !k.endsWith("_raw")
                                    );
                                    if (visibleEntries.length === 0) return null;
                                    return (
                                        <div style={{ fontSize: 13 }}>
                                            <Text strong style={{ display: "block", marginBottom: 8 }}>
                                                {t("archive.extractedFields", "Extracted Fields")}
                                            </Text>
                                            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: "6px 24px" }}>
                                                {visibleEntries.map(([k, v]) => (
                                                    <div key={k} style={{ display: "flex", gap: 6 }}>
                                                        <Text type="secondary" style={{ whiteSpace: "nowrap" }}>
                                                            {k.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())}:
                                                        </Text>
                                                        <Text>{String(v ?? "—")}</Text>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    );
                                })()}
                                {(!fields || Object.keys(fields).length === 0) && warnings.length === 0 && !record.extraction_error && (
                                    <Text type="secondary" style={{ fontSize: 12 }}>
                                        {t("archive.noExtractedData", "No extracted data.")}
                                    </Text>
                                )}
                            </Space>
                        );
                    },
                    rowExpandable: (r) =>
                        !!(r.extracted_fields && Object.keys(r.extracted_fields).length > 0) ||
                        !!(r.extraction_warnings && r.extraction_warnings.length > 0) ||
                        !!r.extraction_error,
                }}
            />

            <Modal
                title={t("archive.uploadTitle", "Upload Document")}
                open={uploadModalOpen}
                onOk={handleUpload}
                onCancel={() => { setUploadModalOpen(false); resetForm(); }}
                okText={t("archive.uploadBtn", "Upload")}
                confirmLoading={uploading}
                width={480}
                destroyOnClose
            >
                {uploadWarnings.length > 0 && (
                    <Alert
                        type="warning"
                        showIcon
                        message={t("archive.extractionWarnings", "Extraction Warnings")}
                        description={<ul style={{ margin: 0, paddingLeft: 16 }}>{uploadWarnings.map((w, i) => <li key={i}>{w}</li>)}</ul>}
                        style={{ marginBottom: 16 }}
                    />
                )}
                <Form form={form} layout="vertical">
                    <Form.Item
                        name="document_type"
                        label={t("archive.docType", "Document Type")}
                        rules={[{ required: true }]}
                    >
                        <Select
                            options={DOCUMENT_TYPE_OPTIONS}
                            onChange={(v) => { setDocType(v); form.setFieldValue("document_type", v); }}
                            placeholder={t("archive.selectType", "Select type")}
                        />
                    </Form.Item>

                    {docType === "OTHER" && (
                        <Form.Item
                            name="custom_name"
                            label={t("archive.customName", "Custom Name")}
                            rules={[{ required: true, message: t("archive.customNameRequired", "Custom name is required for 'Other' type.") }]}
                        >
                            <Input placeholder={t("archive.customNamePlaceholder", "e.g. Medical Certificate")} />
                        </Form.Item>
                    )}

                    <Form.Item
                        label={t("archive.file", "File")}
                        required
                    >
                        <Upload
                            accept=".pdf,.PDF,.jpg,.jpeg,.png,.JPG,.JPEG,.PNG"
                            maxCount={1}
                            fileList={fileList}
                            beforeUpload={(file) => {
                                setSelectedFile(file);
                                setFileList([{ uid: file.uid || "-1", name: file.name, status: "done" }]);
                                return false;
                            }}
                            onRemove={() => { setSelectedFile(null); setFileList([]); }}
                        >
                            <Button icon={<UploadOutlined />}>
                                {t("archive.selectFile", "Select File")}
                            </Button>
                        </Upload>
                        <Text type="secondary" style={{ fontSize: 12 }}>
                            {t("archive.fileHint", "PDF or image. Visa documents should be PDF.")}
                        </Text>
                    </Form.Item>
                </Form>
            </Modal>
        </div>
    );
}
