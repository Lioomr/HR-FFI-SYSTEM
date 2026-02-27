import { Form, Input } from "antd";
import type { ColumnsType } from "antd/es/table";

import { ReferenceCrudPage } from "../../../components/crud";
import {
  createRentType,
  listRentTypes,
  updateRentType,
  type CreateRentTypeDto,
  type RentType,
  type UpdateRentTypeDto,
} from "../../../services/api/rentTypesApi";
import { useI18n } from "../../../i18n/useI18n";

export default function RentTypesPage() {
  const { t } = useI18n();

  const columns: ColumnsType<RentType> = [
    { title: "ID", dataIndex: "id", key: "id", width: 80 },
    { title: t("reference.departments.colCode", "Code"), dataIndex: "code", key: "code", width: 140 },
    { title: t("reference.departments.colName", "Name"), dataIndex: "name", key: "name" },
    { title: t("common.description", "Description"), dataIndex: "description", key: "description" },
  ];

  const createForm = (
    <>
      <Form.Item
        label={t("reference.departments.colCode", "Code")}
        name="code"
        rules={[{ required: true, message: t("common.required", "Required") }]}
      >
        <Input placeholder="e.g., OFFICE" />
      </Form.Item>
      <Form.Item
        label={t("reference.departments.colName", "Name")}
        name="name"
        rules={[{ required: true, message: t("common.required", "Required") }]}
      >
        <Input placeholder="e.g., Office Rent" />
      </Form.Item>
      <Form.Item label={t("common.description", "Description")} name="description">
        <Input.TextArea rows={3} placeholder="Optional description" />
      </Form.Item>
    </>
  );

  return (
    <ReferenceCrudPage<RentType, CreateRentTypeDto, UpdateRentTypeDto>
      title={t("layout.rentTypes", "Rent Types")}
      entityName={t("layout.rentTypes", "Rent Type")}
      columns={columns}
      rowKey="id"
      fetchList={listRentTypes}
      createItem={createRentType}
      updateItem={updateRentType}
      createForm={createForm}
      editForm={createForm}
      initialEditValues={(row) => ({ code: row.code, name: row.name, description: row.description })}
      disableEdit={() => false}
      mapListResponse={(data) => ({ items: Array.isArray(data) ? data : [], total: Array.isArray(data) ? data.length : 0 })}
    />
  );
}
