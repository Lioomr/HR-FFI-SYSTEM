/**
 * Currency formatting utilities for SAR (Saudi Riyal)
 * Uses the Saudi Riyal symbol (ر.س) instead of dollar sign
 */

// Re-export SARIcon for convenience
export { default as SARIcon } from '../components/icons/SARIcon';

/**
 * Format a number as Saudi Riyal currency
 * @param amount - The numeric amount to format
 * @param showSymbol - Whether to append the SAR symbol (default: true)
 * @returns Formatted string with SAR symbol
 * 
 * @example
 * formatSAR(5000) // "5,000 ر.س"
 * formatSAR(5000.50) // "5,000.50 ر.س"
 * formatSAR(5000, false) // "5,000"
 */
export function formatSAR(amount: number | null | undefined, showSymbol: boolean = true): string {
    if (amount === null || amount === undefined || isNaN(amount)) {
        return showSymbol ? "0 ر.س" : "0";
    }

    const formatted = amount.toLocaleString('en-US', {
        minimumFractionDigits: 0,
        maximumFractionDigits: 2
    });

    return showSymbol ? `${formatted} ر.س` : formatted;
}

/**
 * Generic number formatter used across the app.
 * - Accepts number or numeric string
 * - Removes unnecessary trailing decimals (.00)
 * - Keeps up to 2 fractional digits when needed
 */
export function formatNumber(value: number | string | null | undefined): string {
    if (value === null || value === undefined || value === "") return "0";
    const numeric = typeof value === "number" ? value : Number(value);
    if (Number.isNaN(numeric)) return "0";
    return numeric.toLocaleString("en-US", {
        minimumFractionDigits: 0,
        maximumFractionDigits: 2,
    });
}

/**
 * Format a large amount in thousands (k) notation with SAR symbol
 * @param amount - The numeric amount to format
 * @returns Formatted string in thousands with SAR symbol
 * 
 * @example
 * formatSARThousands(125000) // "125k ر.س"
 * formatSARThousands(1500000) // "1,500k ر.س"
 */
export function formatSARThousands(amount: number | null | undefined): string {
    if (amount === null || amount === undefined || isNaN(amount)) {
        return "0k ر.س";
    }

    const thousands = amount / 1000;
    const formatted = thousands.toLocaleString('en-US', {
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
    });

    return `${formatted}k ر.س`;
}

/**
 * SAR currency symbol
 */
export const SAR_SYMBOL = "ر.س";
