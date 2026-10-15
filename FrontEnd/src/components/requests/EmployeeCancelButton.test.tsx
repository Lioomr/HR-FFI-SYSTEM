import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { notification } from "antd";
import EmployeeCancelButton from "./EmployeeCancelButton";
import { useI18nStore } from "../../i18n/i18nStore";
import type { WorkflowSnapshot } from "../../types/workflow";

beforeEach(() => {
  vi.restoreAllMocks();
  useI18nStore.getState().setLanguage("en");
});
const workflow = (can_cancel?: boolean): WorkflowSnapshot => ({
  status: "in_review",
  history: [],
  can_cancel,
});
describe("EmployeeCancelButton", () => {
  it("shows Arabic confirmation labels", async () => {
    await useI18nStore.getState().setLanguage("ar");
    render(
      <EmployeeCancelButton
        request={{ id: 1, can_cancel: true }}
        cancelRequest={vi.fn()}
        onCancelled={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "إلغاء الطلب" }));
    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByRole("button", { name: "الاحتفاظ بالطلب" }),
    ).toBeInTheDocument();
  });
  it("keeps loading feedback and prevents repeated submissions", async () => {
    let complete!: (value: { status: "success"; data: { id: number } }) => void;
    const cancel = vi.fn().mockReturnValue(
      new Promise((resolve) => {
        complete = resolve;
      }),
    );
    const refresh = vi.fn();
    vi.spyOn(notification, "success").mockImplementation(() => {});
    render(
      <EmployeeCancelButton
        request={{ id: 1, can_cancel: true }}
        cancelRequest={cancel}
        onCancelled={refresh}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Cancel request" }));
    const dialog = await screen.findByRole("dialog");
    const confirm = within(dialog).getByRole("button", {
      name: "Cancel request",
    });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(confirm).toHaveClass("ant-btn-loading");
    expect(
      within(dialog).getByRole("button", { name: "Keep request" }),
    ).toBeDisabled();
    complete({ status: "success", data: { id: 1 } });
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  });
  it.each([
    [undefined, undefined, false],
    [undefined, true, true],
    [false, true, false],
    [true, false, true],
  ])(
    "uses workflow permission %s before fallback %s",
    (flag, fallback, visible) => {
      render(
        <EmployeeCancelButton
          request={{ id: 1, workflow: workflow(flag), can_cancel: fallback }}
          cancelRequest={vi.fn()}
          onCancelled={vi.fn()}
        />,
      );
      expect(
        Boolean(screen.queryByRole("button", { name: "Cancel request" })),
      ).toBe(visible);
    },
  );
  it("waits for confirmation, prevents row navigation, calls once then refreshes", async () => {
    const cancel = vi
      .fn()
      .mockResolvedValue({ status: "success", data: { id: 1 } });
    const refresh = vi.fn();
    const parentClick = vi.fn();
    vi.spyOn(notification, "success").mockImplementation(() => {});
    render(
      <div onClick={parentClick}>
        <EmployeeCancelButton
          request={{ id: 1, can_cancel: true }}
          cancelRequest={cancel}
          onCancelled={refresh}
        />
      </div>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Cancel request" }));
    expect(cancel).not.toHaveBeenCalled();
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Cancel request" }),
    );
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(cancel).toHaveBeenCalledExactlyOnceWith(1);
    expect(parentClick).not.toHaveBeenCalled();
  });
  it("lets the user keep the request", async () => {
    const cancel = vi.fn();
    render(
      <EmployeeCancelButton
        request={{ id: 1, can_cancel: true }}
        cancelRequest={cancel}
        onCancelled={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Cancel request" }));
    fireEvent.click(
      within(await screen.findByRole("dialog")).getByRole("button", {
        name: "Keep request",
      }),
    );
    expect(cancel).not.toHaveBeenCalled();
  });
  it.each([undefined, 403, 404, 422])(
    "shows the server message on envelope/HTTP error (status=%s)",
    async (status) => {
      const error = {
        status: "error",
        message: "The request is already processed.",
      };
      const cancel = status
        ? vi.fn().mockRejectedValue({ response: { status, data: error } })
        : vi.fn().mockResolvedValue(error);
      const refresh = vi.fn();
      const toast = vi
        .spyOn(notification, "error")
        .mockImplementation(() => {});
      render(
        <EmployeeCancelButton
          request={{ id: 1, can_cancel: true }}
          cancelRequest={cancel}
          onCancelled={refresh}
        />,
      );
      fireEvent.click(screen.getByRole("button", { name: "Cancel request" }));
      fireEvent.click(
        within(await screen.findByRole("dialog")).getByRole("button", {
          name: "Cancel request",
        }),
      );
      await waitFor(() =>
        expect(toast).toHaveBeenCalledWith(
          expect.objectContaining({ description: error.message }),
        ),
      );
      expect(refresh).not.toHaveBeenCalled();
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    },
  );
});
