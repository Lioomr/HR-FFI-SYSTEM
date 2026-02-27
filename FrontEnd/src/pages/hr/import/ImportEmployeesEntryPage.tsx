import React, { useState } from "react";
import { Upload, Button, Card, Alert, Typography, message } from "antd";
import { InboxOutlined, UploadOutlined, FileExcelOutlined, DownloadOutlined } from "@ant-design/icons";
import type { UploadProps } from "antd";
import { useNavigate } from "react-router-dom";
import { importEmployees, downloadImportTemplate } from "../../../services/api/employeesApi";
import { unwrapEnvelope } from "../../../utils/dataUtils";
import { useI18n } from "../../../i18n/useI18n";

const { Title, Text } = Typography;
const { Dragger } = Upload;

const ImportEmployeesEntryPage: React.FC = () => {
    const navigate = useNavigate();
    const { t } = useI18n();
    const [uploading, setUploading] = useState(false);
    const [fileList, setFileList] = useState<any[]>([]);

    const handleUpload = async () => {
        if (fileList.length === 0) {
            message.error(t("import.employees.selectFile"));
            return;
        }

        const file = fileList[0];
        setUploading(true);

        try {
            const response = await importEmployees(file as File);
            const { inserted_rows } = unwrapEnvelope(response);
            message.success(t("import.employees.successMsg", { inserted: inserted_rows }));
            // Backend is synchronous and doesn't return ID, so we go to history
            setTimeout(() => {
                navigate("/hr/import/employees/history");
            }, 1500);
        } catch (error: any) {
            // Extract detailed error message from backend response
            let errorMessage = "Upload failed";

            // Check if error has response data with errors array
            if (error?.response?.data?.errors && Array.isArray(error.response.data.errors)) {
                const errors = error.response.data.errors;
                if (errors.length > 0) {
                    // Display the first error message
                    errorMessage = typeof errors[0] === 'string'
                        ? errors[0]
                        : errors[0].message || errorMessage;
                }
            } else if (error?.apiData?.errors && Array.isArray(error.apiData.errors)) {
                // Fallback: check apiData (from interceptor)
                const errors = error.apiData.errors;
                if (errors.length > 0) {
                    errorMessage = typeof errors[0] === 'string'
                        ? errors[0]
                        : errors[0].message || errorMessage;
                }
            } else if (error.message) {
                errorMessage = error.message;
            }

            message.error(errorMessage);
        } finally {
            setUploading(false);
        }
    };

    const uploadProps: UploadProps = {
        onRemove: (file) => {
            setFileList((curr) => {
                const index = curr.indexOf(file);
                const newFileList = curr.slice();
                newFileList.splice(index, 1);
                return newFileList;
            });
        },
        beforeUpload: (file) => {
            const isXlsx = file.type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
            if (!isXlsx) {
                message.error(t("import.employees.excelOnly"));
                return Upload.LIST_IGNORE;
            }

            const isLt5M = file.size / 1024 / 1024 < 5;
            if (!isLt5M) {
                message.error(t("import.employees.sizeLimit"));
                return Upload.LIST_IGNORE;
            }

            setFileList([file]); // Keep only latest file
            return false; // Prevent auto upload
        },
        fileList,
        multiple: false,
        maxCount: 1,
        accept: ".xlsx",
    };

    return (
        <div style={{ maxWidth: 800, margin: "0 auto", padding: "24px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
                <Title level={2} style={{ margin: 0 }}>{t("import.employees.title")}</Title>
                <Button
                    onClick={() => navigate("/hr/import/employees/history")}
                    icon={<FileExcelOutlined />}
                >
                    {t("import.employees.viewHistory")}
                </Button>
            </div>

            <Alert
                message={t("import.employees.alertTitle")}
                description={t("import.employees.alertDesc")}
                type="warning"
                showIcon
                style={{ marginBottom: 24 }}
            />

            {/* Instructions Card */}
            <Card title={t("import.employees.instructionsTitle")} style={{ marginBottom: 24 }}>
                <div style={{ marginBottom: 16 }}>
                    <Text strong>{t("import.employees.requirements")}</Text>
                    <ul style={{ marginTop: 8, marginBottom: 16 }}>
                        <li>{t("import.employees.fileFormat")} <Text code>.xlsx</Text></li>
                        <li>{t("import.employees.maxSize")} <Text code>5MB</Text></li>
                        <li>{t("import.employees.maxRows")} <Text code>5,000</Text></li>
                        <li>{t("import.employees.headersMatch")}</li>
                    </ul>
                </div>

                <div style={{ marginBottom: 16 }}>
                    <Text strong>{t("import.employees.autoCreation")}</Text>
                    <ul style={{ marginTop: 8, marginBottom: 16 }}>
                        <li>{t("import.employees.autoCreateDesc")} <Text type="success">{t("import.employees.autoCreatedLabel")}</Text></li>
                        <li>{t("import.employees.existDesc")}</li>
                    </ul>
                </div>

                <Button
                    type="primary"
                    icon={<DownloadOutlined />}
                    size="large"
                    onClick={async () => {
                        try {
                            const blob = await downloadImportTemplate();
                            const url = window.URL.createObjectURL(blob);
                            const a = document.createElement("a");
                            a.href = url;
                            a.download = "employee_import_template.xlsx";
                            document.body.appendChild(a);
                            a.click();
                            window.URL.revokeObjectURL(url);
                            document.body.removeChild(a);
                            message.success(t("import.employees.templateSuccess"));
                        } catch (e) {
                            message.error(t("import.employees.templateFail"));
                        }
                    }}
                >
                    {t("import.employees.download")}
                </Button>
            </Card>

            {/* Upload Card */}
            <Card title={t("import.employees.uploadTitle")}>
                <Dragger {...uploadProps} disabled={uploading} style={{ padding: 20 }}>
                    <p className="ant-upload-drag-icon">
                        <InboxOutlined style={{ fontSize: 48, color: "#1890ff" }} />
                    </p>
                    <p className="ant-upload-text" style={{ fontSize: 16, fontWeight: 500 }}>
                        {t("import.employees.dragDrop")}
                    </p>
                    <p className="ant-upload-hint" style={{ color: "#8c8c8c" }}>
                        {t("import.employees.uploadHint")}
                    </p>
                </Dragger>

                <div style={{ marginTop: 24, textAlign: "right" }}>
                    <Button
                        type="primary"
                        size="large"
                        onClick={handleUpload}
                        disabled={fileList.length === 0}
                        loading={uploading}
                        icon={<UploadOutlined />}
                    >
                        {uploading ? t("import.employees.processing") : t("import.employees.start")}
                    </Button>
                </div>
            </Card>
        </div>
    );
};

export default ImportEmployeesEntryPage;
