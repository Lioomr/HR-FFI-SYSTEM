import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Space,
  Table,
  Tooltip,
  Typography,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import {
  AimOutlined,
  DeleteOutlined,
  EditOutlined,
  EnvironmentOutlined,
  PlusOutlined,
} from "@ant-design/icons";

import PageHeader from "../../components/ui/PageHeader";
import LoadingState from "../../components/ui/LoadingState";
import EmptyState from "../../components/ui/EmptyState";
import ErrorState from "../../components/ui/ErrorState";
import Unauthorized403Page from "../Unauthorized403Page";

import {
  createWorkLocation,
  deleteWorkLocation,
  listWorkLocations,
  toWritePayload,
  updateWorkLocation,
} from "../../services/api/workLocationsApi";
import type { WorkLocation } from "../../services/api/workLocationsApi";
import { isApiError } from "../../services/api/apiTypes";
import { isForbidden } from "../../services/api/httpErrors";
import { apply422ToForm } from "../../utils/formErrors";
import { notifyError, notifySuccess } from "../../utils/notify";
import { useI18n } from "../../i18n/useI18n";
import {
  useAuthStore,
  resolveAuthorizedActiveOrganizationId,
} from "../../auth/authStore";
import { isHeadOfficeOrganization } from "../../utils/organizationContext";
import { parseCoordinatePair } from "../../utils/coordinates";
import WorkLocationMapPicker from "../../components/workLocations/WorkLocationMapPicker";

const PAGE_SIZE = 25;

type FormValues = {
  name: string;
  latitude: string;
  longitude: string;
  radius_meters: number;
};

export default function AdminWorkLocationsPage() {
  const { t } = useI18n();
  const [form] = Form.useForm<FormValues>();

  const user = useAuthStore((state) => state.user);
  const isHeadOffice = isHeadOfficeOrganization(user);
  const activeOrganizationId = user
    ? resolveAuthorizedActiveOrganizationId(user)
    : null;

  const [items, setItems] = useState<WorkLocation[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingRow, setEditingRow] = useState<WorkLocation | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [locating, setLocating] = useState(false);

  const previousOrganizationIdRef = useRef<string | number | null>(null);

  // The map mirrors the live form values, so manual entry, paste, and
  // "use my current location" all drive it through the same single source.
  const watchedLatitude = Form.useWatch("latitude", form);
  const watchedLongitude = Form.useWatch("longitude", form);
  const watchedRadius = Form.useWatch("radius_meters", form);

  /** Map interactions write back through the same six-decimal serialisation. */
  function handleMapPick(nextLatitude: number, nextLongitude: number) {
    form.setFieldsValue({
      latitude: nextLatitude.toFixed(6),
      longitude: nextLongitude.toFixed(6),
    });
  }

  const loadLocations = useCallback(
    async (currentPage: number) => {
      // Head Office is not a company, so the backend refuses this scoped list
      // with 403. Skip the request entirely: otherwise the 403 would swap the
      // page for Unauthorized403Page instead of the "switch to a company"
      // notice. Also drop any rows left over from the previous company.
      if (isHeadOffice) {
        setItems([]);
        setTotal(0);
        setError(null);
        setForbidden(false);
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);
      setForbidden(false);

      try {
        const response = await listWorkLocations({
          page: currentPage,
          page_size: PAGE_SIZE,
        });

        if (isApiError(response)) {
          setError(response.message || t("workLocations.loadFailed"));
          return;
        }

        setItems(response.data.items ?? []);
        setTotal(response.data.count ?? response.data.items?.length ?? 0);
      } catch (err: any) {
        if (isForbidden(err)) {
          setForbidden(true);
          return;
        }
        setError(err?.message || t("workLocations.loadFailed"));
      } finally {
        setLoading(false);
      }
    },
    [t, isHeadOffice],
  );

  useEffect(() => {
    loadLocations(page);
  }, [loadLocations, page]);

  // Switching the active company rescopes every row, so drop back to page 1
  // and refetch instead of showing the previous company's list.
  useEffect(() => {
    if (previousOrganizationIdRef.current === null) {
      previousOrganizationIdRef.current = activeOrganizationId;
      return;
    }

    if (previousOrganizationIdRef.current !== activeOrganizationId) {
      previousOrganizationIdRef.current = activeOrganizationId;
      if (page === 1) loadLocations(1);
      else setPage(1);
    }
  }, [activeOrganizationId, page, loadLocations]);

  function openCreate() {
    setEditingRow(null);
    form.resetFields();
    setModalOpen(true);
  }

  function openEdit(row: WorkLocation) {
    setEditingRow(row);
    form.setFieldsValue({
      name: row.name,
      latitude: row.latitude,
      longitude: row.longitude,
      radius_meters: row.radius_meters,
    });
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
    setEditingRow(null);
    form.resetFields();
  }

  /**
   * Populates the exact `latitude`/`longitude` fields from the browser's
   * Geolocation API. No map provider is bundled in this repository, so this is
   * the approved dependency-free way to capture a site's real coordinates.
   */
  function useCurrentLocation() {
    if (!navigator.geolocation) {
      notifyError(t("workLocations.geolocationUnsupported"));
      return;
    }

    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        form.setFieldsValue({
          latitude: position.coords.latitude.toFixed(6),
          longitude: position.coords.longitude.toFixed(6),
        });
        setLocating(false);
        notifySuccess(t("workLocations.geolocationCaptured"));
      },
      () => {
        setLocating(false);
        notifyError(t("workLocations.geolocationFailed"));
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  function handlePastedCoordinates(raw: string) {
    const parsed = parseCoordinatePair(raw);
    if (!parsed) {
      notifyError(t("workLocations.pasteInvalid"));
      return;
    }
    form.setFieldsValue({
      latitude: parsed.latitude.toFixed(6),
      longitude: parsed.longitude.toFixed(6),
    });
    notifySuccess(t("workLocations.pasteApplied"));
  }

  async function handleSubmit() {
    if (isHeadOffice) {
      notifyError(t("organization.headOffice.switchToCreateRecords"));
      return;
    }

    let values: FormValues;
    try {
      values = await form.validateFields();
    } catch {
      return; // Ant Design already surfaces the field errors.
    }

    // Hard allow-list: only name/latitude/longitude/radius_meters leave the
    // client. `company`/`company_id` are server-injected and rejected with 422.
    const payload = toWritePayload(values);

    setSubmitting(true);
    try {
      const response = editingRow
        ? await updateWorkLocation(editingRow.id, payload)
        : await createWorkLocation(payload);

      if (isApiError(response)) {
        if (response.errors && response.errors.length > 0) {
          apply422ToForm(form, response);
        }
        // Render the backend message as returned, without rewriting it.
        notifyError(
          response.message ||
            (editingRow
              ? t("workLocations.updateFailed")
              : t("workLocations.createFailed")),
        );
        return;
      }

      notifySuccess(
        editingRow
          ? t("workLocations.updateSuccess")
          : t("workLocations.createSuccess"),
      );
      closeModal();
      loadLocations(page);
    } catch (err: any) {
      if (isForbidden(err)) {
        setForbidden(true);
        setModalOpen(false);
        return;
      }
      apply422ToForm(form, err);
      notifyError(
        err?.message ||
          (editingRow
            ? t("workLocations.updateFailed")
            : t("workLocations.createFailed")),
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(row: WorkLocation) {
    if (isHeadOffice) {
      notifyError(t("organization.headOffice.switchToCreateRecords"));
      return;
    }

    setDeletingId(row.id);
    try {
      const response = await deleteWorkLocation(row.id);
      if (isApiError(response)) {
        notifyError(response.message || t("workLocations.deleteFailed"));
        return;
      }

      notifySuccess(t("workLocations.deleteSuccess"));

      // Soft delete removes the row from the active list. Step back a page when
      // the last row of a trailing page goes away.
      const nextPage = items.length === 1 && page > 1 ? page - 1 : page;
      if (nextPage !== page) setPage(nextPage);
      else loadLocations(page);
    } catch (err: any) {
      if (isForbidden(err)) {
        setForbidden(true);
        return;
      }
      notifyError(err?.message || t("workLocations.deleteFailed"));
    } finally {
      setDeletingId(null);
    }
  }

  const columns: ColumnsType<WorkLocation> = useMemo(
    () => [
      {
        title: t("workLocations.column.name"),
        dataIndex: "name",
        key: "name",
        render: (value: string) => <strong>{value}</strong>,
      },
      {
        title: t("workLocations.column.latitude"),
        dataIndex: "latitude",
        key: "latitude",
        responsive: ["md"],
      },
      {
        title: t("workLocations.column.longitude"),
        dataIndex: "longitude",
        key: "longitude",
        responsive: ["md"],
      },
      {
        title: t("workLocations.column.radius"),
        dataIndex: "radius_meters",
        key: "radius_meters",
        render: (value: number) => t("workLocations.metresValue", { value }),
      },
      {
        title: t("workLocations.column.company"),
        dataIndex: "company_name",
        key: "company_name",
        responsive: ["lg"],
      },
      {
        title: t("common.actions"),
        key: "actions",
        align: "right",
        render: (_: unknown, row: WorkLocation) => (
          <Space>
            <Tooltip title={t("common.edit")}>
              <Button
                size="small"
                icon={<EditOutlined />}
                onClick={() => openEdit(row)}
                aria-label={t("workLocations.editAria", { name: row.name })}
              />
            </Tooltip>
            <Popconfirm
              title={t("workLocations.deleteConfirmTitle")}
              description={t("workLocations.deleteConfirmDescription", {
                name: row.name,
              })}
              okText={t("common.delete")}
              cancelText={t("common.cancel")}
              okButtonProps={{ danger: true }}
              onConfirm={() => handleDelete(row)}
            >
              <Tooltip title={t("common.delete")}>
                <Button
                  size="small"
                  danger
                  icon={<DeleteOutlined />}
                  loading={deletingId === row.id}
                  aria-label={t("workLocations.deleteAria", { name: row.name })}
                />
              </Tooltip>
            </Popconfirm>
          </Space>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t, deletingId, items, page],
  );

  if (forbidden) return <Unauthorized403Page />;

  return (
    <div>
      <PageHeader
        title={t("workLocations.title")}
        subtitle={t("workLocations.subtitle")}
        actions={
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={openCreate}
            disabled={isHeadOffice}
          >
            {t("workLocations.addButton")}
          </Button>
        }
      />

      {isHeadOffice ? (
        // Work locations belong to a company, so Head Office gets the notice
        // and nothing else — no list request, no rows, no empty-state CTA.
        <Alert
          type="info"
          showIcon
          message={t("organization.headOffice.readOnlyTitle")}
          description={t("workLocations.headOfficeNotice")}
        />
      ) : loading ? (
        <LoadingState title={t("workLocations.loading")} />
      ) : error ? (
        <ErrorState
          title={t("workLocations.loadFailedTitle")}
          description={error}
          onRetry={() => loadLocations(page)}
        />
      ) : items.length === 0 ? (
        <EmptyState
          title={t("workLocations.emptyTitle")}
          description={t("workLocations.emptyDescription")}
          actionText={t("workLocations.addButton")}
          onAction={openCreate}
        />
      ) : (
        <Card style={{ borderRadius: 16 }}>
          <Table<WorkLocation>
            rowKey="id"
            columns={columns}
            dataSource={items}
            scroll={{ x: "max-content" }}
            pagination={{
              current: page,
              pageSize: PAGE_SIZE,
              total,
              showSizeChanger: false,
              onChange: (nextPage) => setPage(nextPage),
            }}
          />
        </Card>
      )}

      <Modal
        open={modalOpen}
        title={
          editingRow
            ? t("workLocations.editTitle")
            : t("workLocations.createTitle")
        }
        okText={editingRow ? t("common.save") : t("common.create")}
        cancelText={t("common.cancel")}
        confirmLoading={submitting}
        onOk={handleSubmit}
        onCancel={closeModal}
        maskClosable={!submitting}
        width={720}
      >
        <Form<FormValues> form={form} layout="vertical" requiredMark={false}>
          <Form.Item
            label={t("workLocations.field.name")}
            name="name"
            rules={[
              { required: true, message: t("workLocations.rule.nameRequired") },
              { max: 120, message: t("workLocations.rule.nameMax") },
            ]}
          >
            <Input
              maxLength={120}
              placeholder={t("workLocations.placeholder.name")}
            />
          </Form.Item>

          <Space
            direction="vertical"
            size={4}
            style={{ width: "100%", marginBottom: 16 }}
          >
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {t("workLocations.pickerHint")}
            </Typography.Text>
            <Space wrap>
              <Button
                icon={<AimOutlined />}
                onClick={useCurrentLocation}
                loading={locating}
              >
                {t("workLocations.useCurrentLocation")}
              </Button>
              <Input
                allowClear
                style={{ width: 240 }}
                prefix={<EnvironmentOutlined />}
                placeholder={t("workLocations.placeholder.paste")}
                aria-label={t("workLocations.pasteAria")}
                onPressEnter={(event) => {
                  event.preventDefault();
                  handlePastedCoordinates(event.currentTarget.value);
                }}
              />
            </Space>
          </Space>

          <div style={{ marginBottom: 8 }}>
            <WorkLocationMapPicker
              latitude={watchedLatitude}
              longitude={watchedLongitude}
              radiusMeters={watchedRadius}
              onChange={handleMapPick}
            />
          </div>

          <Typography.Text
            type="secondary"
            style={{ fontSize: 12, display: "block", marginBottom: 16 }}
          >
            {t("workLocations.map.privacyHint")}
          </Typography.Text>

          <Space style={{ width: "100%" }} align="start" wrap>
            <Form.Item
              label={t("workLocations.field.latitude")}
              name="latitude"
              rules={[
                {
                  required: true,
                  message: t("workLocations.rule.latitudeRequired"),
                },
              ]}
              style={{ minWidth: 200 }}
            >
              <InputNumber
                stringMode
                step="0.000001"
                min={-90}
                max={90}
                style={{ width: "100%" }}
                placeholder="24.713600"
              />
            </Form.Item>

            <Form.Item
              label={t("workLocations.field.longitude")}
              name="longitude"
              rules={[
                {
                  required: true,
                  message: t("workLocations.rule.longitudeRequired"),
                },
              ]}
              style={{ minWidth: 200 }}
            >
              <InputNumber
                stringMode
                step="0.000001"
                min={-180}
                max={180}
                style={{ width: "100%" }}
                placeholder="46.675300"
              />
            </Form.Item>

            <Form.Item
              label={t("workLocations.field.radius")}
              name="radius_meters"
              rules={[
                {
                  required: true,
                  message: t("workLocations.rule.radiusRequired"),
                },
              ]}
              style={{ minWidth: 200 }}
            >
              <InputNumber
                min={1}
                step={10}
                precision={0}
                style={{ width: "100%" }}
                addonAfter={t("workLocations.metresUnit")}
                placeholder="100"
              />
            </Form.Item>
          </Space>

          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {t("workLocations.companyScopeNote")}
          </Typography.Text>
        </Form>
      </Modal>
    </div>
  );
}
