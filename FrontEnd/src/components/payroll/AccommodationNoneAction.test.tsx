import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import AccommodationNoneAction from "./AccommodationNoneAction";
import * as accommodation from "../../services/api/accommodationApi";
import { useAuthStore } from "../../auth/authStore";
import { useI18nStore } from "../../i18n/i18nStore";
import type { AccommodationAssignment } from "../../services/api/payrollTypes";

beforeEach(async () => {
  await useI18nStore.getState().setLanguage("en");
  useAuthStore.setState({
    isAuthenticated: true,
    user: { id: "hr", email: "hr@test", role: "HRManager" },
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  useAuthStore.setState({ isAuthenticated: false, user: null });
});
function mount() {
  const refresh = vi.fn().mockResolvedValue(undefined);
  render(
    <AccommodationNoneAction
      employeeProfileId={101}
      name="Recorded employee"
      year={2026}
      month={2}
      onSaved={refresh}
    />,
  );
  return refresh;
}
async function confirm() {
  fireEvent.click(
    screen.getByRole("button", { name: "Set 'none' for this month" }),
  );
  const dialog = await screen.findByRole("dialog");
  expect(within(dialog).getByText(/Recorded employee/)).toBeInTheDocument();
  return dialog;
}
describe("single employee accommodation none action", () => {
  it("requires explicit confirmation/reason, sends one request and refreshes", async () => {
    const write = vi
      .spyOn(accommodation, "createAssignment")
      .mockResolvedValue({} as AccommodationAssignment);
    const refresh = mount();
    const dialog = await confirm();
    expect(write).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await screen.findByText("Enter a reason.");
    expect(write).not.toHaveBeenCalled();
    fireEvent.change(within(dialog).getByLabelText("Reason"), {
      target: { value: "Employee uses private accommodation" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(write).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledWith({
      employee_profile_id: 101,
      status: "none",
      rent_id: null,
      start_date: "2026-02-01",
      end_date: "2026-02-28",
      reason: "Employee uses private accommodation",
    });
  });
  it("keeps an overlap inline, reloads evidence and never retries", async () => {
    const write = vi
      .spyOn(accommodation, "createAssignment")
      .mockRejectedValue({
        response: {
          status: 409,
          data: {
            errors: [
              {
                code: "assignment_overlap",
                message: "Recorded overlap",
                params: { start_date: "2026-02-01", end_date: "2026-02-15" },
              },
            ],
          },
        },
      });
    const refresh = mount();
    const dialog = await confirm();
    fireEvent.change(within(dialog).getByLabelText("Reason"), {
      target: { value: "Review housing" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(await screen.findByText(/Recorded overlap/)).toBeInTheDocument();
    expect(screen.getByText(/2026-02-15/)).toBeInTheDocument();
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(write).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
  it("has no action for CFO", () => {
    useAuthStore.setState({
      user: { id: "cfo", email: "cfo@test", role: "CFO" },
    });
    mount();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
