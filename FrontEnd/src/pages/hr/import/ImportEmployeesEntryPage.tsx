import React, { useState } from "react";
import { Upload, Button, Card, Alert, Typography, message } from "antd";
import { InboxOutlined, UploadOutlined, FileExcelOutlined, DownloadOutlined } from "@ant-design/icons";
import type { UploadProps } from "antd";
import { useNavigate } from "react-router-dom";
import { importEmployees, downloadImportTemplate } from "../../../services/api/employeesApi";
import { unwrapEnvelope } from "../../../utils/dataUtils";

const { Title, Text } = Typography;
const { Dragger } = Upload;

// Exact headers required by Backend (employees/views.py)
// Note: Spaces are intentionally preserved as per backend contract.
const REQUIRED_HEADERS = [
    "Emp Full Name",
    "Employee number ",       // Space at the end
    "Nationality ",           // Space at the end
    "Position Name",
    "Passport Number",
    "Passport Expiry",
    " ID",                    // Space at the start
    " ID Expiry",             // Space at the start
    "Date Of Birth",
    "JOB OFFER ",             // Space at the end
    " Joining Date",          // Space at the start
    "Contract date ",         // Space at the end
    "Contract Expiry Date ",  // Space at the end
    "Task Group Name",
    "Health Card",
    "Health Card Expiry",
    "Mobile Number",
    "Sponsor Code",
    "Basic Salary",
    "Transportation Allowance",
    "Accommodation Allowance",
    "Telephone Allowance",
    "Petrol Allowance",
    "Other Allowance",
    "Total Salary",
    "Payment Mode",
    "Allowed Overtime",
    "department",
    "SID monthly expense"
];

const ImportEmployeesEntryPage: React.FC = () => {
    const navigate = useNavigate();
    const [uploading, setUploading] = useState(false);
    const [fileList, setFileList] = useState<any[]>([]);

    const handleUpload = async () => {
        if (fileList.length === 0) {
            message.error("Please select a file to upload");
            return;
        }

        const file = fileList[0];
        setUploading(true);

        try {
            const response = await importEmployees(file as File);
            const { inserted_rows } = unwrapEnvelope(response);
            message.success(`Import Successful! ${inserted_rows} employees inserted.`);
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
                message.error("You can only upload Excel (.xlsx) files!");
                return Upload.LIST_IGNORE;
            }

            const isLt5M = file.size / 1024 / 1024 < 5;
            if (!isLt5M) {
                message.error("File must be smaller than 5MB!");
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
                <Title level={2} style={{ margin: 0 }}>Import Employees</Title>
                <Button
                    onClick={() => navigate("/hr/import/employees/history")}
                    icon={<FileExcelOutlined />}
                >
                    View Import History
                </Button>
            </div>

            <Alert
                message="Running in All-or-Nothing Mode"
                description="If any row in the file fails validation, the entire import will be rejected. Please ensure your data is clean."
                type="warning"
                showIcon
                style={{ marginBottom: 24 }}
            />

            {/* Instructions Card */}
            <Card title="📋 Instructions" style={{ marginBottom: 24 }}>
                <div style={{ marginBottom: 16 }}>
                    <Text strong>Requirements:</Text>
                    <ul style={{ marginTop: 8, marginBottom: 16 }}>
                        <li>File format: <Text code>.xlsx</Text> only</li>
                        <li>Maximum file size: <Text code>5MB</Text></li>
                        <li>Maximum rows: <Text code>5,000</Text></li>
                        <li>Headers must match the template exactly</li>
                    </ul>
                </div>

                <div style={{ marginBottom: 16 }}>
                    <Text strong>Auto-Creation:</Text>
                    <ul style={{ marginTop: 8, marginBottom: 16 }}>
                        <li>Departments and Positions will be <Text type="success">auto-created</Text> if they don't exist</li>
                        <li>Task Groups and Sponsors must exist in the system beforehand</li>
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
                            message.success("Template downloaded successfully");
                        } catch (e) {
                            message.error("Failed to download template");
                        }
                    }}
                >
                    Download Excel Template
                </Button>
            </Card>

            {/* Upload Card */}
            <Card title="📤 Upload File">
                <Dragger {...uploadProps} disabled={uploading} style={{ padding: 20 }}>
                    <p className="ant-upload-drag-icon">
                        <InboxOutlined style={{ fontSize: 48, color: "#1890ff" }} />
                    </p>
                    <p className="ant-upload-text" style={{ fontSize: 16, fontWeight: 500 }}>
                        Click or drag Excel file to upload
                    </p>
                    <p className="ant-upload-hint" style={{ color: "#8c8c8c" }}>
                        Only .xlsx files are supported. File will be validated before import.
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
                        {uploading ? 'Processing Import...' : 'Start Import'}
                    </Button>
                </div>
            </Card>
        </div>
    );
};

export default ImportEmployeesEntryPage;
