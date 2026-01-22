import { Form, Input } from "antd";
import type { ColumnsType } from "antd/es/table";

import { ReferenceCrudPage } from "../../../components/crud";
import type { Sponsor } from "../../../services/api/sponsorsApi";
import {
    listSponsors,
    createSponsor,
    updateSponsor,
    type CreateSponsorDto,
    type UpdateSponsorDto,
} from "../../../services/api/sponsorsApi";

/**
 * Table columns definition
 */
const columns: ColumnsType<Sponsor> = [
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
 * Note: code is required, name is optional per specs
 */
const CreateForm = (
    <>
        <Form.Item
            label="Code"
            name="code"
            rules={[
                { required: true, message: "Please enter sponsor code" },
                { max: 20, message: "Code must be at most 20 characters" },
            ]}
        >
            <Input placeholder="e.g., SPONSOR-001" />
        </Form.Item>

        <Form.Item
            label="Name"
            name="name"
            rules={[
                { max: 100, message: "Name must be at most 100 characters" },
            ]}
        >
            <Input placeholder="Optional sponsor name" />
        </Form.Item>

        <Form.Item label="Description" name="description">
            <Input.TextArea rows={3} placeholder="Optional description" />
        </Form.Item>
    </>
);

/**
 * Edit form fields (same as create for sponsors)
 */
const EditForm = CreateForm;

/**
 * Sponsors management page
 * Special handling: code is required, name is optional
 * Duplicate code errors will be shown inline via 422 mapping
 */
export default function SponsorsPage() {
    return (
        <ReferenceCrudPage<Sponsor, CreateSponsorDto, UpdateSponsorDto>
            title="Sponsors"
            entityName="Sponsor"
            columns={columns}
            rowKey="id"
            fetchList={listSponsors}
            createItem={createSponsor}
            updateItem={updateSponsor}
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
