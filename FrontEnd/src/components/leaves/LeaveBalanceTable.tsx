import React from "react";
import { Table, Tag } from "antd";
import type { LeaveBalance } from "../../services/api/apiTypes";

interface LeaveBalanceTableProps {
    balances: LeaveBalance[];
    loading: boolean;
}

const LeaveBalanceTable: React.FC<LeaveBalanceTableProps> = ({ balances, loading }) => {
    const columns = [
        {
            title: "Leave Type",
            dataIndex: "leave_type",
            key: "leave_type",
            render: (text: string) => <strong>{text}</strong>,
        },
        {
            title: "Total",
            dataIndex: "total_days",
            key: "total_days",
            render: (val: number) => <span>{Number(val || 0).toFixed(1)}</span>,
        },
        {
            title: "Used",
            dataIndex: "used_days",
            key: "used_days",
            render: (val: number) => {
                const num = Number(val || 0);
                return <span style={{ color: num > 0 ? "orange" : "inherit" }}>{num.toFixed(1)}</span>;
            },
        },
        {
            title: "Remaining",
            dataIndex: "remaining_days",
            key: "remaining_days",
            render: (val: number) => {
                const num = Number(val || 0);
                const color = num <= 0 ? "red" : num < 5 ? "orange" : "green";
                return <Tag color={color}>{num.toFixed(1)} Days</Tag>;
            },
        },
    ];



    return (
        <Table
            dataSource={balances}
            columns={columns}
            rowKey="leave_type_id"
            loading={loading}
            pagination={false}
            bordered
            size="middle"
            scroll={{ x: 600 }}
        />
    );
};

export default LeaveBalanceTable;
