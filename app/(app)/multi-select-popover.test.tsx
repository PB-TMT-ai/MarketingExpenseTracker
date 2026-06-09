// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import MultiSelectPopover from "./multi-select-popover";

describe("MultiSelectPopover", () => {
  const baseProps = {
    label: "Region",
    options: ["North", "South", "East", "West"],
    selected: [] as string[],
    onChange: vi.fn(),
  };

  it("renders the label and a count badge only when items are selected", () => {
    const { rerender } = render(<MultiSelectPopover {...baseProps} />);
    expect(screen.getByRole("button", { name: /Region/i })).toBeTruthy();
    expect(screen.queryByText("(2)")).toBeNull();

    rerender(<MultiSelectPopover {...baseProps} selected={["North", "South"]} />);
    expect(screen.getByText("(2)")).toBeTruthy();
  });

  it("opens the panel and lists every option as a checkbox", () => {
    render(<MultiSelectPopover {...baseProps} />);
    fireEvent.click(screen.getByRole("button", { name: /Region/i }));
    baseProps.options.forEach((o) => {
      expect(screen.getByRole("checkbox", { name: o })).toBeTruthy();
    });
  });

  it("calls onChange with the next selection when an option toggles", () => {
    const onChange = vi.fn();
    render(<MultiSelectPopover {...baseProps} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /Region/i }));
    fireEvent.click(screen.getByRole("checkbox", { name: "North" }));
    expect(onChange).toHaveBeenCalledWith(["North"]);
  });

  it("filters options by the search box (case-insensitive)", () => {
    render(<MultiSelectPopover {...baseProps} />);
    fireEvent.click(screen.getByRole("button", { name: /Region/i }));
    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: "ea" } });
    expect(screen.queryByRole("checkbox", { name: "North" })).toBeNull();
    expect(screen.getByRole("checkbox", { name: "East" })).toBeTruthy();
  });

  it("disables the trigger and shows em-dash when options is empty", () => {
    render(<MultiSelectPopover {...baseProps} options={[]} />);
    const btn = screen.getByRole("button", { name: /Region/i });
    expect(btn.hasAttribute("disabled")).toBe(true);
    expect(btn.textContent).toMatch(/—/);
  });

  it("Select all selects every option; Clear empties the selection", () => {
    const onChange = vi.fn();
    render(<MultiSelectPopover {...baseProps} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /Region/i }));
    fireEvent.click(screen.getByRole("button", { name: /select all/i }));
    expect(onChange).toHaveBeenLastCalledWith(["North", "South", "East", "West"]);

    onChange.mockClear();
    fireEvent.click(screen.getByRole("button", { name: /clear/i }));
    expect(onChange).toHaveBeenLastCalledWith([]);
  });
});
