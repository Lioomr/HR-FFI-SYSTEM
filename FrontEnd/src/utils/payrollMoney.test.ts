import { describe, expect, it } from "vitest";
import {
  formatExactShare,
  formatMoney,
  isExactShareTruncated,
  isNonNegativeDecimal,
  isValidPercent,
  moneyToInput,
  percentToRate,
  rateToPercent,
  toMoneyString,
} from "./payrollMoney";

describe("formatMoney", () => {
  it("shows whole-riyal payroll lines without halalas", () => {
    expect(formatMoney("733.00")).toBe("733");
    expect(formatMoney("102670.00")).toBe("102,670");
    expect(formatMoney("0.00")).toBe("0");
  });

  it("keeps legacy halalas exactly, never rounding them", () => {
    expect(formatMoney("1234.50")).toBe("1,234.50");
    expect(formatMoney("166.67")).toBe("166.67");
    expect(formatMoney("0.10")).toBe("0.10");
  });

  it("formats values a float cannot hold exactly (no float drift)", () => {
    // 2^53 + 1 is not representable as a JavaScript number.
    expect(Number("9007199254740993")).toBe(9007199254740992);
    expect(formatMoney("9007199254740993.00")).toBe("9,007,199,254,740,993");
    expect(formatMoney("123456789012345678.05")).toBe(
      "123,456,789,012,345,678.05",
    );
  });

  it("returns null for null, undefined or malformed values (never 0)", () => {
    expect(formatMoney(null)).toBeNull();
    expect(formatMoney(undefined)).toBeNull();
    expect(formatMoney("1e3")).toBeNull();
    expect(formatMoney("12,000.00")).toBeNull();
    expect(formatMoney("")).toBeNull();
  });

  it("keeps a negative legacy sign but not on zero", () => {
    expect(formatMoney("-50.25")).toBe("-50.25");
    expect(formatMoney("-0.00")).toBe("0");
  });
});

describe("ExactShare display", () => {
  const third = {
    numerator: "1000.00",
    denominator: 3,
    decimal: "333.3333333333333333333333333",
  };

  it("cuts (does not round) the decimal approximation", () => {
    expect(formatExactShare(third)).toBe("333.33");
    expect(
      formatExactShare({
        numerator: "2",
        denominator: 3,
        decimal: "0.6666666",
      }),
    ).toBe("0.66");
    expect(isExactShareTruncated(third)).toBe(true);
  });

  it("shows exact values without an approximation marker", () => {
    const exact = {
      numerator: "12000.00",
      denominator: 12,
      decimal: "1000.00",
    };
    expect(formatExactShare(exact)).toBe("1,000");
    expect(isExactShareTruncated(exact)).toBe(false);
  });
});

describe("rates as percentages", () => {
  it("converts contract rate strings to percentages with string shifts", () => {
    expect(rateToPercent("0.020000")).toBe("2");
    expect(rateToPercent("0.097500")).toBe("9.75");
    expect(rateToPercent("1.000000")).toBe("100");
    expect(rateToPercent("0.000001")).toBe("0.0001");
  });

  it("sends six-place rate strings, never percentages or floats", () => {
    expect(percentToRate("2")).toBe("0.020000");
    expect(percentToRate("9.75")).toBe("0.097500");
    expect(percentToRate("100")).toBe("1.000000");
    expect(percentToRate("0.0001")).toBe("0.000001");
    // 0.1 + 0.2 style inputs stay exact.
    expect(percentToRate("0.3")).toBe("0.003000");
  });

  it("round-trips without drift", () => {
    for (const rate of ["0.020000", "0.097500", "0.123400", "0.000000"]) {
      expect(percentToRate(rateToPercent(rate))).toBe(rate);
    }
  });

  it("validates percentages in 0..100 with up to four decimals", () => {
    expect(isValidPercent("9.75")).toBe(true);
    expect(isValidPercent("100")).toBe(true);
    expect(isValidPercent("100.5")).toBe(false);
    expect(isValidPercent("101")).toBe(false);
    expect(isValidPercent("1.23456")).toBe(false);
    expect(isValidPercent("-1")).toBe(false);
    expect(isValidPercent("2%")).toBe(false);
  });
});

describe("money inputs", () => {
  it("accepts nonnegative decimals with up to two places only", () => {
    expect(isNonNegativeDecimal("862.50")).toBe(true);
    expect(isNonNegativeDecimal("12000")).toBe(true);
    expect(isNonNegativeDecimal("1.234")).toBe(false);
    expect(isNonNegativeDecimal("-5")).toBe(false);
    expect(isNonNegativeDecimal("1e3")).toBe(false);
    expect(isNonNegativeDecimal("=1+1")).toBe(false);
  });

  it("normalises to two-place strings and back", () => {
    expect(toMoneyString("12000")).toBe("12000.00");
    expect(toMoneyString("862.5")).toBe("862.50");
    expect(toMoneyString("007.10")).toBe("7.10");
    expect(moneyToInput("12000.00")).toBe("12000");
    expect(moneyToInput("862.50")).toBe("862.50");
    expect(moneyToInput(null)).toBe("");
  });
});
