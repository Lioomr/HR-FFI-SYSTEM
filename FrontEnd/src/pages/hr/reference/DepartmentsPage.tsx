import { Form, Input } from "antd";
import type { ColumnsType } from "antd/es/table";

import { ReferenceCrudPage } from "../../../components/crud";
import type { Department } from "../../../services/api/departmentsApi";
import {
    listDepartments,
    createDepartment,
    updateDepartment,
    type CreateDepartmentDto,
    type UpdateDepartmentDto,
} from "../../../services/api/departmentsApi";

/**
 * Table columns definition
 */
const columns: ColumnsType<Department> = [
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
                { required: true, message: "Please enter department code" },
                { max: 10, message: "Code must be at most 10 characters" },
            ]}
        >
            <Input placeholder="e.g., ENG" />
        </Form.Item>

        <Form.Item
            label="Name"
            name="name"
            rules={[
                { required: true, message: "Please enter department name" },
                { max: 100, message: "Name must be at most 100 characters" },
            ]}
        >
            <Input placeholder="e.g., Engineering" />
        </Form.Item>

        <Form.Item label="Description" name="description">
            <Input.TextArea rows={3} placeholder="Optional description" />
        </Form.Item>
    </>
);

/**
 * Edit form fields (same as create for departments)
 */
const EditForm = CreateForm;

/**
 * Departments management page
 */
export default function DepartmentsPage() {
    return (
        <ReferenceCrudPage<Department, CreateDepartmentDto, UpdateDepartmentDto>
            title="Departments"
            entityName="Department"
            columns={columns}
            rowKey="id"
            fetchList={listDepartments}
            createItem={createDepartment}
            updateItem={updateDepartment}
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
