import { Form, Input } from "antd";
import type { ColumnsType } from "antd/es/table";

import { ReferenceCrudPage } from "../../../components/crud";
import type { Position } from "../../../services/api/positionsApi";
import {
    listPositions,
    createPosition,
    updatePosition,
    type CreatePositionDto,
    type UpdatePositionDto,
} from "../../../services/api/positionsApi";
import { useI18n } from "../../../i18n/useI18n";

/**
 * Positions management page
 */
export default function PositionsPage() {
    const { t } = useI18n();

    /**
     * Table columns definition
     */
    const columns: ColumnsType<Position> = [
        {
            title: "ID",
            dataIndex: "id",
            key: "id",
            width: 80,
        },
        {
            title: t("reference.departments.colCode"),
            dataIndex: "code",
            key: "code",
            width: 120,
        },
        {
            title: t("reference.departments.colName"),
            dataIndex: "name",
            key: "name",
        },
        {
            title: t("common.description"),
            dataIndex: "description",
            key: "description",
        },
    ];

    /**
     * Create form fields
     */
    const CreateForm = (
        <>
            <Form.Item
                label={t("reference.departments.colCode")}
                name="code"
                rules={[
                    { required: true, message: t("common.required") },
                    { max: 10, message: "Code must be at most 10 characters" },
                ]}
            >
                <Input placeholder="e.g., MGR" />
            </Form.Item>

            <Form.Item
                label={t("reference.departments.colName")}
                name="name"
                rules={[
                    { required: true, message: t("common.required") },
                    { max: 100, message: "Name must be at most 100 characters" },
                ]}
            >
                <Input placeholder="e.g., Manager" />
            </Form.Item>

            <Form.Item label={t("common.description")} name="description">
                <Input.TextArea rows={3} placeholder="Optional description" />
            </Form.Item>
        </>
    );

    /**
     * Edit form fields (same as create for positions)
     */
    const EditForm = CreateForm;

    return (
        <ReferenceCrudPage<Position, CreatePositionDto, UpdatePositionDto>
            title={t("reference.positions.title")}
            entityName={t("reference.positions.create")}
            columns={columns}
            rowKey="id"
            fetchList={listPositions}
            createItem={createPosition}
            updateItem={updatePosition}
            createForm={CreateForm}
            editForm={EditForm}
            initialEditValues={(row) => ({
                code: row.code,
                name: row.name,
                description: row.description,
            })}
        />
    );
}
