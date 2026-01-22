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
        title: "Code",
        dataIndex: "code",
        key: "code",
        width: 120,
    },
    {
        title: "Name",
        dataIndex: "name",
        key: "name",
    },
    {
        title: "Description",
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
            label="Code"
            name="code"
            rules={[
                { required: true, message: "Please enter position code" },
                { max: 10, message: "Code must be at most 10 characters" },
            ]}
        >
            <Input placeholder="e.g., MGR" />
        </Form.Item>

        <Form.Item
            label="Name"
            name="name"
            rules={[
                { required: true, message: "Please enter position name" },
                { max: 100, message: "Name must be at most 100 characters" },
            ]}
        >
            <Input placeholder="e.g., Manager" />
        </Form.Item>

        <Form.Item label="Description" name="description">
            <Input.TextArea rows={3} placeholder="Optional description" />
        </Form.Item>
    </>
);

/**
 * Edit form fields (same as create for positions)
 */
const EditForm = CreateForm;

/**
 * Positions management page
 */
export default function PositionsPage() {
    return (
        <ReferenceCrudPage<Position, CreatePositionDto, UpdatePositionDto>
            title="Positions"
            entityName="Position"
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
