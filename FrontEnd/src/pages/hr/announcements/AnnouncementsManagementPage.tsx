import { useEffect, useState } from 'react';
import { Table, Button, Space, Tag, message, Tooltip, Popconfirm } from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined, ReloadOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { getAllAnnouncements, deleteAnnouncement, type AnnouncementListItem } from '../../../services/api/announcementApi';
import { useI18n } from '../../../i18n/useI18n';

export default function AnnouncementsManagementPage() {
    const navigate = useNavigate();
    const { t } = useI18n();
    const [loading, setLoading] = useState(false);
    const [data, setData] = useState<AnnouncementListItem[]>([]);
    const [pagination, setPagination] = useState({
        current: 1,
        pageSize: 10,
        total: 0,
    });

    const loadData = async (page = 1, pageSize = 10) => {
        setLoading(true);
        try {
            const response = await getAllAnnouncements(page, pageSize);
            if (response.status === 'success') {
                const announcements = response.data.items || [];
                setData(announcements);
                setPagination({
                    current: page,
                    pageSize: pageSize,
                    total: response.data.count || 0,
                });
            }
        } catch (error) {
            message.error(t('hr.announcements.errorLoad'));
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadData(pagination.current, pagination.pageSize);
    }, []);

    const handleDelete = async (id: number) => {
        try {
            await deleteAnnouncement(id);
            message.success(t('hr.announcements.successDeleted'));
            loadData(pagination.current, pagination.pageSize);
        } catch (error) {
            message.error(t('hr.announcements.errorDelete'));
        }
    };

    const handleTableChange = (newPagination: any) => {
        loadData(newPagination.current, newPagination.pageSize);
    };

    const roleColors: Record<string, string> = {
        ADMIN: 'red',
        HR_MANAGER: 'blue',
        MANAGER: 'purple',
        EMPLOYEE: 'green',
    };

    const columns = [
        {
            title: t('hr.announcements.tableTitle'),
            dataIndex: 'title',
            key: 'title',
            render: (text: string) => <strong>{text}</strong>,
        },
        {
            title: t('hr.announcements.tableTargetRoles'),
            dataIndex: 'target_roles',
            key: 'target_roles',
            render: (roles: string[]) => (
                <>
                    {roles.map((role) => {
                        let displayRole = role.replace('_', ' ');
                        switch (role) {
                            case 'ADMIN': displayRole = t('auth.role.admin'); break;
                            case 'HR_MANAGER': displayRole = t('auth.role.hr_manager'); break;
                            case 'MANAGER': displayRole = t('auth.role.manager'); break;
                            case 'EMPLOYEE': displayRole = t('auth.role.employee'); break;
                        }
                        return (
                            <Tag color={roleColors[role] || 'default'} key={role}>
                                {displayRole}
                            </Tag>
                        );
                    })}
                </>
            ),
        },
        {
            title: t('hr.announcements.tableCreatedBy'),
            dataIndex: 'created_by_name',
            key: 'created_by',
        },
        {
            title: t('common.date'),
            dataIndex: 'created_at',
            key: 'created_at',
            render: (date: string) => new Date(date).toLocaleDateString(),
        },
        {
            title: t('common.actions'),
            key: 'actions',
            render: (_: any, record: AnnouncementListItem) => (
                <Space size="middle">
                    <Tooltip title={t('common.edit')}>
                        <Button
                            type="text"
                            icon={<EditOutlined style={{ color: '#faad14' }} />}
                            onClick={() => navigate(`/hr/announcements/${record.id}/edit`)}
                        />
                    </Tooltip>
                    <Popconfirm
                        title={t('hr.announcements.deletePopconfirmTitle')}
                        description={t('hr.announcements.deletePopconfirmDesc')}
                        onConfirm={() => handleDelete(record.id)}
                        okText={t('common.yes')}
                        cancelText={t('common.no')}
                    >
                        <Button type="text" danger icon={<DeleteOutlined />} />
                    </Popconfirm>
                </Space>
            ),
        },
    ];

    return (
        <div style={{ padding: 24 }}>
            <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h1 style={{ fontSize: 24, margin: 0 }}>{t('hr.announcements.managementTitle')}</h1>
                <Space>
                    <Button icon={<ReloadOutlined />} onClick={() => loadData(pagination.current, pagination.pageSize)}>
                        {t('common.refresh')}
                    </Button>
                    <Button
                        type="primary"
                        icon={<PlusOutlined />}
                        onClick={() => navigate('/hr/announcements/create')}
                        style={{ background: '#FF7F3E', borderColor: '#FF7F3E' }}
                    >
                        {t('hr.announcements.createButton')}
                    </Button>
                </Space>
            </div>

            <Table
                columns={columns}
                dataSource={data}
                rowKey="id"
                pagination={pagination}
                loading={loading}
                onChange={handleTableChange}
                bordered
            />
        </div>
    );
}
