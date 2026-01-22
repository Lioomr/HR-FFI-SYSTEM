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
            dataIndex: "leave_type_name",
            key: "leave_type_name",
            render: (text: string) => <strong>{text}</strong>,
        },
        {
            title: "Opening Balance",
            dataIndex: "opening_balance",
            key: "opening_balance",
            render: (val: string) => <span>{parseFloat(val).toFixed(1)}</span>,
        },
        {
            title: "Used",
            dataIndex: "used",
            key: "used",
            render: (val: string) => {
                const num = parseFloat(val);
                return <span style={{ color: num > 0 ? "orange" : "inherit" }}>{num.toFixed(1)}</span>;
            },
        },
        {
            title: "Remaining",
            dataIndex: "remaining",
            key: "remaining",
            render: (val: string) => {
                const num = parseFloat(val);
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
        />
    );
};

export default LeaveBalanceTable;
