import React from 'react';
import { Space } from 'antd';
import { SARIcon } from '../../utils/currency';
import { formatNumber } from '../../utils/currency';

interface AmountWithSARProps {
    amount: number | string | null | undefined;
    size?: number;
    color?: string;
    style?: React.CSSProperties;
    fontWeight?: string | number;
    className?: string;
    suffix?: React.ReactNode;
}

/**
 * Displays a number formatted with the SAR logo icon.
 * Standardizes financial displays across the app.
 */
export default function AmountWithSAR({
    amount,
    size = 14,
    color = '#000000',
    style,
    fontWeight,
    className,
    suffix
}: AmountWithSARProps) {
    return (
        <Space
            size={4}
            className={className}
            style={{ alignItems: 'center', whiteSpace: 'nowrap', flexWrap: 'nowrap', ...style }}
        >
            <span style={{ fontWeight: fontWeight || 'inherit', whiteSpace: 'nowrap' }}>
                {formatNumber(amount)}
                {suffix}
            </span>
            <SARIcon size={size} color={color} />
        </Space>
    );
}
