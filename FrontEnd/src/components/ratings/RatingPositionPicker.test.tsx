import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Button, Form } from "antd";

import { ManagerRecommendationFields } from "./RatingCriteriaForm";
import type { RatingFormValues } from "./ratingHelpers";
import { listRatingPositions } from "../../services/api/contractRatingsApi";
import { useI18nStore } from "../../i18n/i18nStore";

vi.mock("../../services/api/contractRatingsApi", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../services/api/contractRatingsApi")
  >()),
  listRatingPositions: vi.fn(),
}));

const lookup = vi.mocked(listRatingPositions);

function Picker({
  onFinish = vi.fn(),
}: {
  onFinish?: (values: RatingFormValues) => void;
}) {
  const [form] = Form.useForm<RatingFormValues>();
  return (
    <Form
      form={form}
      onFinish={onFinish}
      initialValues={{
        recommendation: "CONTINUE_WITH_CHANGES",
        recommended_change_types: ["POSITION_CHANGE"],
      }}
    >
      <ManagerRecommendationFields
        form={form}
        ratingId={7}
        contractExpiry="2026-12-15"
      />
      <Button htmlType="submit">Save recommendation</Button>
    </Form>
  );
}

beforeEach(() => {
  useI18nStore.getState().setLanguage("en");
  lookup.mockReset().mockResolvedValue({
    status: "success",
    data: [{ id: 42, name: "Senior Engineer" }],
  });
});

describe("rating position picker", () => {
  it("loads names for the rating and submits the selected numeric ID", async () => {
    const onFinish = vi.fn();
    render(<Picker onFinish={onFinish} />);
    await waitFor(() => expect(lookup).toHaveBeenCalledWith(7));
    fireEvent.mouseDown(screen.getByRole("combobox"));
    fireEvent.click(await screen.findByText("Senior Engineer"));
    fireEvent.click(
      screen.getByRole("button", { name: "Save recommendation" }),
    );
    await waitFor(() =>
      expect(onFinish).toHaveBeenCalledWith(
        expect.objectContaining({ proposed_position_id: 42 }),
      ),
    );
    expect(screen.queryByRole("spinbutton")).toBeNull();
  });

  it("shows a retryable failure instead of a raw ID input", async () => {
    lookup.mockRejectedValueOnce(new Error("Unavailable"));
    render(<Picker />);
    expect(
      await screen.findByText(
        "The position list could not be loaded. Please retry.",
      ),
    ).toBeTruthy();
    expect(screen.getByRole("combobox")).toBeDisabled();
    expect(screen.queryByRole("spinbutton")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(lookup).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(screen.getByRole("combobox")).not.toBeDisabled(),
    );
    fireEvent.mouseDown(screen.getByRole("combobox"));
    expect(await screen.findByText("Senior Engineer")).toBeTruthy();
  });
});
