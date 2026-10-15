import { afterEach, expect, it } from "vitest";
import { fireEvent, render, screen, cleanup } from "@testing-library/react";
import RunHeadlineTotals from "./RunHeadlineTotals";
import PayrollTheme from "./PayrollTheme";
import * as examples from "../../services/api/payrollMocks/contractExamples";
import type {
  PayrollRunDto,
  PayrollRunSummaryDto,
} from "../../services/api/payrollTypes";
afterEach(cleanup);
it("uses a neutral three-cell strip with no colored top border and one shared disclosure", () => {
  render(
    <PayrollTheme>
      <RunHeadlineTotals
        run={examples.run.data as unknown as PayrollRunDto}
        summary={examples.summary.data as unknown as PayrollRunSummaryDto}
        costIncompleteReasons={[]}
      />
    </PayrollTheme>,
  );
  const strip = screen.getByTestId("payroll-kpi-strip");
  expect(strip.querySelectorAll(".payroll-kpi")).toHaveLength(3);
  for (const node of strip.querySelectorAll<HTMLElement>("*"))
    expect(node.style.borderTop).toBe("");
  const controls = strip.querySelectorAll("button[aria-expanded]");
  expect(controls).toHaveLength(1);
  expect(controls[0]).toHaveAttribute("aria-expanded", "false");
  fireEvent.click(controls[0]);
  expect(controls[0]).toHaveAttribute("aria-expanded", "true");
  expect(document.querySelectorAll(".payroll-breakdown")).toHaveLength(1);
});
