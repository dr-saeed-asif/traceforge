import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import Loading from "./loading";

describe("route loading state", () => {
  it("announces asynchronous verification loading", () => {
    render(<Loading />);

    expect(screen.getByRole("status")).toHaveTextContent("Loading verification data");
  });
});
