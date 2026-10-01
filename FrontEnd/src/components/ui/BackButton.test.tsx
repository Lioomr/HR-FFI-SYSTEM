import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ConfigProvider } from "antd";
import BackButton from "./BackButton";
import { useI18nStore } from "../../i18n/i18nStore";

afterEach(() => useI18nStore.getState().setLanguage("en"));

describe("BackButton", () => {
  it.each(["en", "ar"] as const)(
    "mirrors arrow direction and placement for %s",
    (language) => {
      useI18nStore.getState().setLanguage(language);
      const onClick = vi.fn();
      render(
        <ConfigProvider direction={language === "ar" ? "rtl" : "ltr"}>
          <BackButton onClick={onClick}>Back</BackButton>
        </ConfigProvider>,
      );
      const button = screen.getByRole("button", { name: "Back" });
      expect(
        button.querySelector(
          `[data-icon="arrow-${language === "ar" ? "left" : "right"}"]`,
        ),
      ).toBeInTheDocument();
      expect(button).toHaveClass("ant-btn-icon-end");
      fireEvent.click(button);
      expect(onClick).toHaveBeenCalledOnce();
    },
  );

  it("keeps disabled controls disabled", () => {
    const onClick = vi.fn();
    render(
      <BackButton disabled onClick={onClick}>
        Back
      </BackButton>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(onClick).not.toHaveBeenCalled();
  });
});
