import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import NationalityFlag from "./NationalityFlag";

describe("NationalityFlag", () => {
  it("renders a flag-icons image for a known nationality", () => {
    const { container } = render(<NationalityFlag nationality="India" />);
    expect(container.querySelector(".fi.fi-in")).not.toBeNull();
  });

  it("renders a country-code prefixed value", () => {
    const { container } = render(
      <NationalityFlag nationality="SA Saudi Arabia" />,
    );
    expect(container.querySelector(".fi.fi-sa")).not.toBeNull();
  });

  it("falls back to a globe icon when the nationality is unknown or empty", () => {
    const unknown = render(<NationalityFlag nationality="Not a country" />);
    expect(unknown.container.querySelector(".fi")).toBeNull();
    expect(unknown.container.querySelector(".anticon-global")).not.toBeNull();

    const empty = render(<NationalityFlag nationality={undefined} />);
    expect(empty.container.querySelector(".fi")).toBeNull();
    expect(empty.container.querySelector(".anticon-global")).not.toBeNull();
  });
});
