import { isValidElement, Suspense } from "react";
import { describe, expect, it } from "vitest";
import { routes } from "./routes";
import { PasswordRecoveryPage } from "./lazyPages";
import ResetPasswordPage from "../pages/ResetPasswordPage";

describe("password recovery public routes", () => {
  it("registers WhatsApp recovery at the public root with a lazy page", () => {
    const recovery = routes.find((route) => route.path === "/forgot-password");
    expect(recovery).toBeDefined();
    expect(isValidElement(recovery?.element) && recovery.element.type).toBe(
      Suspense,
    );
    const element = recovery?.element as React.ReactElement<{
      children: React.ReactElement;
    }>;
    expect(element.props.children.type).toBe(PasswordRecoveryPage);
  });
  it("preserves the administrator email reset route", () => {
    const legacy = routes.find((route) => route.path === "/reset-password");
    expect(isValidElement(legacy?.element) && legacy.element.type).toBe(
      ResetPasswordPage,
    );
  });
});
