import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EmptyState, ErrorState, LoadingState } from "./states";

describe("shared application states", () => {
  it("announces loading without exposing decorative skeletons", () => {
    render(<LoadingState label="Loading session evidence" />);

    expect(screen.getByRole("status")).toHaveTextContent("Loading session evidence");
  });

  it("uses headings and alert semantics for empty and error states", () => {
    const empty = render(<EmptyState title="Nothing here" description="No matching records." />);
    expect(screen.getByRole("heading", { name: "Nothing here" })).toBeInTheDocument();
    empty.unmount();

    render(<ErrorState description="The request failed safely." />);
    expect(screen.getByRole("alert")).toHaveTextContent("The request failed safely.");
  });
});
