import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import {
  MemoryRouter,
  Routes,
  Route,
  type RouteObject,
} from "react-router-dom";
import { routes } from "./routes";
function find(nodes: RouteObject[]): RouteObject | undefined {
  for (const node of nodes) {
    if (node.path === "employees/:id") return node;
    const child = node.children && find(node.children);
    if (child) return child;
  }
}
afterEach(cleanup);
it("preserves the employee id in old notification links", async () => {
  render(
    <MemoryRouter initialEntries={["/employees/123"]}>
      <Routes>
        <Route path="employees/:id" element={find(routes)?.element} />
        <Route path="hr/employees/123" element={<div>Employee 123</div>} />
      </Routes>
    </MemoryRouter>,
  );
  expect(await screen.findByText("Employee 123")).toBeInTheDocument();
});
