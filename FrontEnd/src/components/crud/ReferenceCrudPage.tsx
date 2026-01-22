import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Button, Card, Form, Modal, Table } from "antd";
import type { ColumnsType } from "antd/es/table";
import { PlusOutlined, EditOutlined } from "@ant-design/icons";

import PageHeader from "../ui/PageHeader";
import LoadingState from "../ui/LoadingState";
import EmptyState from "../ui/EmptyState";
import ErrorState from "../ui/ErrorState";
import Unauthorized403Page from "../../pages/Unauthorized403Page";

import type { ApiResponse } from "../../services/api/apiTypes";
import { isApiError } from "../../services/api/apiTypes";
import { apply422ToForm } from "../../utils/formErrors";
import { isForbidden } from "../../services/api/httpErrors";
import { notifySuccess, notifyError } from "../../utils/notify";

/**
 * Generic props for ReferenceCrudPage component
 */
export interface ReferenceCrudPageProps<TItem, TCreate, TUpdate> {
    // Required props
    title: string;
    entityName: string;
    columns: ColumnsType<TItem>;
    rowKey: string | ((row: TItem) => string | number);

    // API functions
    fetchList: (params?: any) => Promise<ApiResponse<any>>;
    createItem: (payload: TCreate) => Promise<ApiResponse<any>>;
    updateItem: (id: string | number, payload: TUpdate) => Promise<ApiResponse<any>>;

    // Optional props
    mapListResponse?: (payload: any) => { items: TItem[]; total?: number };
    enablePagination?: boolean;
    pageSize?: number;

    // Form rendering
    createForm?: ReactNode;
    editForm?: ReactNode;

    // Form values
    initialCreateValues?: Partial<TCreate>;
    initialEditValues?: (row: TItem) => Partial<TUpdate>;
    transformCreateValues?: (values: any) => TCreate;
    transformEditValues?: (values: any, row: TItem) => TUpdate;

    // Hooks
    beforeOpenEdit?: (row: TItem) => Promise<void> | void;
    disableEdit?: (row: TItem) => boolean;
}

/**
 * Reusable CRUD page component for reference data management
 * Handles loading, error, empty states, and 403/422 errors consistently
 */
export function ReferenceCrudPage<TItem = any, TCreate = any, TUpdate = any>({
    title,
    entityName,
    columns,
    rowKey,
    fetchList,
    createItem,
    updateItem,
    mapListResponse,
    enablePagination = false,
    pageSize = 25,
    createForm,
    editForm,
    initialCreateValues,
    initialEditValues,
    transformCreateValues,
    transformEditValues,
    beforeOpenEdit,
    disableEdit,
}: ReferenceCrudPageProps<TItem, TCreate, TUpdate>) {
    // State management
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [forbidden, setForbidden] = useState(false);
    const [items, setItems] = useState<TItem[]>([]);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);

    // Modal states
    const [createModalOpen, setCreateModalOpen] = useState(false);
    const [editModalOpen, setEditModalOpen] = useState(false);
    const [currentRow, setCurrentRow] = useState<TItem | null>(null);
    const [submitting, setSubmitting] = useState(false);

    // Forms
    const [createFormInstance] = Form.useForm();
    const [editFormInstance] = Form.useForm();

    /**
     * Fetch list data from API
     */
    const loadData = useCallback(async (currentPage = 1) => {
        setLoading(true);
        setError(null);
        setForbidden(false);

        try {
            const params = enablePagination
                ? { page: currentPage, page_size: pageSize }
                : {};

            const response = await fetchList(params);

            if (isApiError(response)) {
                setError(response.message || "Failed to load data");
                setLoading(false);
                return;
            }

            // Map response to items and total
            const mapped = mapListResponse
                ? mapListResponse(response.data)
                : { items: Array.isArray(response.data) ? response.data : [], total: 0 };

            setItems(mapped.items);
            setTotal(mapped.total || mapped.items.length);
            setLoading(false);
        } catch (err: any) {
            if (isForbidden(err)) {
                setForbidden(true);
                setLoading(false);
                return;
            }

            setError(err.message || "Failed to load data");
            setLoading(false);
        }
    }, [fetchList, mapListResponse, enablePagination, pageSize]);

    /**
     * Initial load
     */
    useEffect(() => {
        loadData(page);
    }, [loadData, page]);

    /**
     * Handle create submission
     */
    const handleCreate = async () => {
        try {
            const values = await createFormInstance.validateFields();
            const payload = transformCreateValues ? transformCreateValues(values) : values;

            setSubmitting(true);
            const response = await createItem(payload);

            if (isApiError(response)) {
                // Apply 422 field errors to form if present
                if (response.errors && response.errors.length > 0) {
                    apply422ToForm(createFormInstance, response);
                }
                notifyError(response.message || `Failed to create ${entityName}`);
                setSubmitting(false);
                return;
            }

            notifySuccess(`${entityName} created successfully`);
            setCreateModalOpen(false);
            createFormInstance.resetFields();
            setSubmitting(false);
            loadData(page);
        } catch (err: any) {
            setSubmitting(false);

            // Handle 422 validation errors
            if (err.errorFields) {
                // Form validation failed, AntD already shows errors
                return;
            }

            // Apply backend 422 errors to form
            apply422ToForm(createFormInstance, err);

            if (isForbidden(err)) {
                setForbidden(true);
                setCreateModalOpen(false);
                return;
            }

            if (!err.response || err.response.status !== 422) {
                notifyError(err.message || `Failed to create ${entityName}`);
            }
        }
    };

    /**
     * Handle edit submission
     */
    const handleEdit = async () => {
        if (!currentRow) return;

        try {
            const values = await editFormInstance.validateFields();
            const rowId = typeof rowKey === "function" ? rowKey(currentRow) : (currentRow as any)[rowKey];
            const payload = transformEditValues ? transformEditValues(values, currentRow) : values;

            setSubmitting(true);
            const response = await updateItem(rowId, payload);

            if (isApiError(response)) {
                // Apply 422 field errors to form if present
                if (response.errors && response.errors.length > 0) {
                    apply422ToForm(editFormInstance, response);
                }
                notifyError(response.message || `Failed to update ${entityName}`);
                setSubmitting(false);
                return;
            }

            notifySuccess(`${entityName} updated successfully`);
            setEditModalOpen(false);
            editFormInstance.resetFields();
            setCurrentRow(null);
            setSubmitting(false);
            loadData(page);
        } catch (err: any) {
            setSubmitting(false);

            // Handle 422 validation errors
            if (err.errorFields) {
                return;
            }

            apply422ToForm(editFormInstance, err);

            if (isForbidden(err)) {
                setForbidden(true);
                setEditModalOpen(false);
                return;
            }

            if (!err.response || err.response.status !== 422) {
                notifyError(err.message || `Failed to update ${entityName}`);
            }
        }
    };

    /**
     * Open edit modal
     */
    const openEditModal = async (row: TItem) => {
        if (beforeOpenEdit) {
            try {
                await beforeOpenEdit(row);
            } catch (err: any) {
                notifyError(err.message || "Failed to prepare edit");
                return;
            }
        }

        setCurrentRow(row);
        const initialValues = initialEditValues ? initialEditValues(row) : row;
        editFormInstance.setFieldsValue(initialValues);
        setEditModalOpen(true);
    };

    /**
     * Add edit action column if editForm is provided
     */
    const enhancedColumns: ColumnsType<TItem> = editForm
        ? [
            ...columns,
            {
                title: "Actions",
                key: "actions",
                width: 100,
                render: (_, record) => (
                    <Button
                        icon={<EditOutlined />}
                        onClick={() => openEditModal(record)}
                        disabled={disableEdit ? disableEdit(record) : false}
                    >
                        Edit
                    </Button>
                ),
            },
        ]
        : columns;

    // Render 403 unauthorized page
    if (forbidden) {
        return <Unauthorized403Page />;
    }

    // Render loading state
    if (loading && items.length === 0) {
        return <LoadingState title={`Loading ${title}...`} />;
    }

    // Render error state
    if (error && items.length === 0) {
        return (
            <ErrorState
                title={`Failed to load ${title}`}
                description={error}
                onRetry={() => loadData(page)}
            />
        );
    }

    // Render empty state
    if (!loading && items.length === 0) {
        return (
            <EmptyState
                title="No data available"
                description={`No ${title.toLowerCase()} found.`}
                actionText={createForm ? `Create ${entityName}` : undefined}
                onAction={createForm ? () => setCreateModalOpen(true) : undefined}
            />
        );
    }

    // Render main content
    return (
        <div>
            <PageHeader
                title={title}
                actions={
                    createForm ? (
                        <Button
                            type="primary"
                            icon={<PlusOutlined />}
                            onClick={() => {
                                createFormInstance.resetFields();
                                if (initialCreateValues) {
                                    createFormInstance.setFieldsValue(initialCreateValues);
                                }
                                setCreateModalOpen(true);
                            }}
                        >
                            Create {entityName}
                        </Button>
                    ) : undefined
                }
            />

            <Card style={{ borderRadius: 16 }}>
                <Table
                    dataSource={items}
                    columns={enhancedColumns}
                    rowKey={rowKey}
                    loading={loading}
                    pagination={
                        enablePagination
                            ? {
                                current: page,
                                pageSize: pageSize,
                                total: total,
                                onChange: (newPage) => setPage(newPage),
                            }
                            : false
                    }
                />
            </Card>

            {/* Create Modal */}
            {createForm && (
                <Modal
                    title={`Create ${entityName}`}
                    open={createModalOpen}
                    onOk={handleCreate}
                    onCancel={() => {
                        setCreateModalOpen(false);
                        createFormInstance.resetFields();
                    }}
                    confirmLoading={submitting}
                    okText="Create"
                >
                    <Form form={createFormInstance} layout="vertical">
                        {createForm}
                    </Form>
                </Modal>
            )}

            {/* Edit Modal */}
            {editForm && (
                <Modal
                    title={`Edit ${entityName}`}
                    open={editModalOpen}
                    onOk={handleEdit}
                    onCancel={() => {
                        setEditModalOpen(false);
                        editFormInstance.resetFields();
                        setCurrentRow(null);
                    }}
                    confirmLoading={submitting}
                    okText="Save"
                >
                    <Form form={editFormInstance} layout="vertical">
                        {editForm}
                    </Form>
                </Modal>
            )}
        </div>
    );
}
