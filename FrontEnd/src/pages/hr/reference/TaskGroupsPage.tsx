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
import { useI18n } from "../../../i18n/useI18n";

/**
 * Task Groups management page
 */
export default function TaskGroupsPage() {
    const { t } = useI18n();

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
                <Input placeholder="e.g., PROJ" />
            </Form.Item>

            <Form.Item
                label={t("reference.departments.colName")}
                name="name"
                rules={[
                    { required: true, message: t("common.required") },
                    { max: 100, message: "Name must be at most 100 characters" },
                ]}
            >
                <Input placeholder="e.g., Project Tasks" />
            </Form.Item>

            <Form.Item label={t("common.description")} name="description">
                <Input.TextArea rows={3} placeholder="Optional description" />
            </Form.Item>
        </>
    );

    /**
     * Edit form fields (same as create for task groups)
     */
    const EditForm = CreateForm;

    return (
        <ReferenceCrudPage<TaskGroup, CreateTaskGroupDto, UpdateTaskGroupDto>
            title={t("reference.taskGroups.title")}
            entityName={t("reference.taskGroups.title")}
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
