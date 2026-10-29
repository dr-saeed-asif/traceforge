import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/features/sessions/sessions-client-wrapper", () => ({
  SessionsClientWrapper: () => <h1>Agent verification sessions</h1>
}));

import SessionsPage from "./page";

describe("SessionsPage", () => {
  it("renders the sessions feature entry point", async () => {
    render(await SessionsPage({ searchParams: Promise.resolve({}) }));
    expect(
      screen.getByRole("heading", { name: "Agent verification sessions" })
    ).toBeInTheDocument();
  });
});
