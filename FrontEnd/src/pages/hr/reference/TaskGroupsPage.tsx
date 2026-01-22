import { Form, Input } from "antd";
import type { ColumnsType } from "antd/es/table";

import { ReferenceCrudPage } from "../../../components/crud";
import type { TaskGroup } from "../../../services/api/taskGroupsApi";
import {
    listTaskGroups,
    createTaskGroup,
    updateTaskGroup,
    type CreateTaskGroupDto,
    type UpdateTaskGroupDto,
} from "../../../services/api/taskGroupsApi";

/**
 * Table columns definition
 */
const columns: ColumnsType<TaskGroup> = [
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
                { required: true, message: "Please enter task group code" },
                { max: 10, message: "Code must be at most 10 characters" },
            ]}
        >
            <Input placeholder="e.g., PROJ" />
        </Form.Item>

        <Form.Item
            label="Name"
            name="name"
            rules={[
                { required: true, message: "Please enter task group name" },
                { max: 100, message: "Name must be at most 100 characters" },
            ]}
        >
            <Input placeholder="e.g., Project Tasks" />
        </Form.Item>

        <Form.Item label="Description" name="description">
            <Input.TextArea rows={3} placeholder="Optional description" />
        </Form.Item>
    </>
);

/**
 * Edit form fields (same as create for task groups)
 */
const EditForm = CreateForm;

/**
 * Task Groups management page
 */
export default function TaskGroupsPage() {
    return (
        <ReferenceCrudPage<TaskGroup, CreateTaskGroupDto, UpdateTaskGroupDto>
            title="Task Groups"
            entityName="Task Group"
            columns={columns}
            rowKey="id"
            fetchList={listTaskGroups}
            createItem={createTaskGroup}
            updateItem={updateTaskGroup}
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
