import React, { useState } from "react";
import { Upload, Button, Card, Alert, Typography, message, Steps } from "antd";
import { InboxOutlined, UploadOutlined, FileExcelOutlined } from "@ant-design/icons";
import type { UploadProps } from "antd";
import { useNavigate } from "react-router-dom";
import { importEmployees } from "../../../services/api/employeesApi";
import { unwrapEnvelope } from "../../../utils/dataUtils";

const { Title, Text, Paragraph } = Typography;
const { Dragger } = Upload;

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
            const { import_id } = unwrapEnvelope(response);
            message.success("File uploaded successfully");
            navigate(`/hr/import/employees/${import_id}/result`);
        } catch (error: any) {
            message.error(error.message || "Upload failed");
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
            <Title level={2}>Import Employees</Title>

            <Steps
                current={0}
                items={[
                    { title: "Upload File" },
                    { title: "Review Result" },
                ]}
                style={{ marginBottom: 32 }}
            />

            <Alert
                message="Running in All-or-Nothing Mode"
                description="If any row in the file fails validation, the entire import will be rejected. Please ensure your data is clean."
                type="warning"
                showIcon
                style={{ marginBottom: 24 }}
            />

            <Card title="1. Prepare your file" style={{ marginBottom: 24 }}>
                <Paragraph>
                    <Text strong>Rules:</Text>
                    <ul>
                        <li>File must be .xlsx format</li>
                        <li>Headers must match exactly: <code>Employee ID, Full Name, Email, Department, Position</code></li>
                        <li>Dates must be formatted as YYYY-MM-DD</li>
                    </ul>
                </Paragraph>
                <Button icon={<FileExcelOutlined />}>Download Template</Button>
            </Card>

            <Card title="2. Upload Data">
                <Dragger {...uploadProps} disabled={uploading} style={{ padding: 20 }}>
                    <p className="ant-upload-drag-icon">
                        <InboxOutlined />
                    </p>
                    <p className="ant-upload-text">Click or drag file to this area to upload</p>
                    <p className="ant-upload-hint">
                        Support for a single .xlsx upload. Strictly prohibited from uploading company data or other
                        banned files.
                    </p>
                </Dragger>

                <div style={{ marginTop: 24, textAlign: "right" }}>
                    <Button
                        type="primary"
                        onClick={handleUpload}
                        disabled={fileList.length === 0}
                        loading={uploading}
                        icon={<UploadOutlined />}
                    >
                        {uploading ? 'Processing...' : 'Start Import'}
                    </Button>
                </div>
            </Card>
        </div>
    );
};

export default ImportEmployeesEntryPage;
