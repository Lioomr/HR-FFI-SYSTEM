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
      width: 72,
      className: "reference-crud__id",
    },
    {
      title: t("reference.departments.colCode"),
      dataIndex: "code",
      key: "code",
      width: 120,
      render: (value: string) =>
        value ? <span className="reference-crud__code">{value}</span> : "-",
    },
    {
      title: t("reference.departments.colName"),
      dataIndex: "name",
      key: "name",
      className: "reference-crud__name",
    },
    {
      title: t("common.description"),
      dataIndex: "description",
      key: "description",
      className: "reference-crud__muted",
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
          { max: 10, message: t("reference.codeMax", { max: 10 }) },
        ]}
      >
        <Input placeholder={t("reference.positions.codePlaceholder")} />
      </Form.Item>

      <Form.Item
        label={t("reference.departments.colName")}
        name="name"
        rules={[
          { required: true, message: t("common.required") },
          { max: 100, message: t("reference.nameMax", { max: 100 }) },
        ]}
      >
        <Input placeholder={t("reference.positions.namePlaceholder")} />
      </Form.Item>

      <Form.Item label={t("common.description")} name="description">
        <Input.TextArea
          rows={3}
          placeholder={t("reference.optionalDescription")}
        />
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
      entityName={t("reference.positions.entity")}
      columns={columns}
      embedded
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
