import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import OrganizationSetupPage from "./OrganizationSetupPage";

vi.mock("../../../i18n/useI18n", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));
vi.mock("./DepartmentsPage", () => ({
  default: () => <div>Departments content</div>,
}));
vi.mock("./PositionsPage", () => ({
  default: () => <div>Positions content</div>,
}));
vi.mock("./TaskGroupsPage", () => ({
  default: () => <div>Task Groups content</div>,
}));
vi.mock("./SponsorsPage", () => ({
  default: () => <div>Sponsors content</div>,
}));

function CurrentLocation() {
  const location = useLocation();
  return (
    <span data-testid="location">{location.pathname + location.search}</span>
  );
}

function renderPage(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path="/hr/organization-setup"
          element={
            <>
              <OrganizationSetupPage />
              <CurrentLocation />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe("Organization setup tabs", () => {
  it("opens the requested section and updates the URL when switching", () => {
    renderPage("/hr/organization-setup?tab=positions");

    expect(screen.getByText("Positions content")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("tab", { name: "reference.sponsors.title" }),
    );
    expect(screen.getByText("Sponsors content")).toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent(
      "/hr/organization-setup?tab=sponsors",
    );
  });

  it("defaults to departments when no section is selected", () => {
    renderPage("/hr/organization-setup");
    expect(screen.getByText("Departments content")).toBeInTheDocument();
  });
});
