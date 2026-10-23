import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { AnchorHashSearch } from "./anchor-hash-search";

vi.mock("@traceforge/verification-contracts", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  parseAnchorLookupResponse: (value: unknown) => value
}));
afterEach(() => vi.unstubAllGlobals());

it("searches decoded session hashes and loads the original claim on selection", async () => {
  const onSelect = vi.fn();
  const hash = `0x${"a".repeat(64)}`;
  const fetchMock = vi.fn(async () => ({
    ok: true,
    json: async () => ({
      matches: [
        {
          sessionHash: hash,
          session: {
            promptId: "p",
            promptQuery: "Create an email validator",
            agentName: "OpenCode",
            modelName: "agent",
            projectName: "test"
          },
          claims: [
            {
              claimIndex: 3,
              claimText: "Created validator.js",
              target: "validator.js",
              verdict: "VERIFIED"
            }
          ]
        }
      ]
    })
  }));
  vi.stubGlobal("fetch", fetchMock);
  render(
    <AnchorHashSearch
      decoded={{
        sessionHash: hash,
        claimIndex: 3,
        manifestHash: hash,
        evidenceRoot: hash,
        schemaVersion: 1,
        verdict: "VERIFIED"
      }}
      onSelect={onSelect}
    />
  );
  await waitFor(() => expect(screen.getByText("Create an email validator")).toBeInTheDocument());
  expect(fetchMock).toHaveBeenCalledWith(
    expect.stringContaining(`sessionHash=${hash}`),
    expect.anything()
  );
  fireEvent.click(screen.getByRole("button", { name: "Load claim 3 for comparison" }));
  expect(onSelect).toHaveBeenCalledWith("p", 3);
  fireEvent.change(screen.getByLabelText("Search by"), { target: { value: "manifestHash" } });
  fireEvent.click(screen.getByRole("button", { name: "Find original claim" }));
  await waitFor(() =>
    expect(fetchMock).toHaveBeenLastCalledWith(
      expect.stringContaining(`manifestHash=${hash}`),
      expect.anything()
    )
  );
});

it("distinguishes no local record from an unavailable backend and rejects malformed hashes", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => ({ matches: [] }) }))
  );
  render(<AnchorHashSearch decoded={null} onSelect={() => undefined} />);
  fireEvent.change(screen.getByLabelText("Hash to find"), { target: { value: "wrong" } });
  fireEvent.click(screen.getByRole("button", { name: "Find original claim" }));
  expect(screen.getByRole("alert")).toHaveTextContent("64 hexadecimal");
  fireEvent.change(screen.getByLabelText("Hash to find"), {
    target: { value: `0x${"b".repeat(64)}` }
  });
  fireEvent.click(screen.getByRole("button", { name: "Find original claim" }));
  await waitFor(() =>
    expect(screen.getByRole("status")).toHaveTextContent("No local record found")
  );
});
