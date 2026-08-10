// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { Button } from "./button/button";
import {
  DialogBody,
  DialogFrame,
  DialogHeader,
  type DialogCloseReason,
} from "./dialog/dialog";
import { Tabs } from "./tabs/tabs";
import {
  computeTooltipPosition,
  HelpTip,
} from "./tooltip/help-tip";

const originalMatches = Element.prototype.matches;
const originalShowModal = HTMLDialogElement.prototype.showModal;
const originalDialogClose = HTMLDialogElement.prototype.close;
const originalShowPopover = HTMLElement.prototype.showPopover;
const originalHidePopover = HTMLElement.prototype.hidePopover;

beforeAll(() => {
  Element.prototype.matches = function matches(selector: string) {
    if (selector === ":popover-open") {
      return this.hasAttribute("data-popover-open");
    }
    return originalMatches.call(this, selector);
  };
});

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function close() {
    this.removeAttribute("open");
  };
  HTMLElement.prototype.showPopover = function showPopover() {
    this.setAttribute("data-popover-open", "");
    this.dispatchEvent(new Event("toggle"));
  };
  HTMLElement.prototype.hidePopover = function hidePopover() {
    this.removeAttribute("data-popover-open");
    this.dispatchEvent(new Event("toggle"));
  };
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

afterAll(() => {
  Element.prototype.matches = originalMatches;
  HTMLDialogElement.prototype.showModal = originalShowModal;
  HTMLDialogElement.prototype.close = originalDialogClose;
  HTMLElement.prototype.showPopover = originalShowPopover;
  HTMLElement.prototype.hidePopover = originalHidePopover;
});

describe("dialog primitive", () => {
  function DialogHarness({
    closeDisabled = false,
    onClose,
  }: {
    closeDisabled?: boolean;
    onClose: (reason: DialogCloseReason) => void;
  }) {
    const [open, setOpen] = useState(false);

    return (
      <>
        <Button onClick={() => setOpen(true)}>Open dialog</Button>
        {open ? (
          <DialogFrame
            aria-labelledby="contract-dialog-title"
            closeDisabled={closeDisabled}
            onRequestClose={(reason) => {
              onClose(reason);
              setOpen(false);
            }}
          >
            <DialogHeader closeLabel="Close">
              <h2 id="contract-dialog-title">Dialog title</h2>
            </DialogHeader>
            <DialogBody>
              <button type="button">Body action</button>
            </DialogBody>
          </DialogFrame>
        ) : null}
      </>
    );
  }

  it("uses one close action and restores focus to the opener", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();

    render(<DialogHarness onClose={onClose} />);
    const opener = screen.getByRole("button", { name: "Open dialog" });
    await user.click(opener);

    expect(screen.getAllByRole("button", { name: "Close" })).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "Body action" }));
    expect(onClose).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledWith("close-button");
    expect(opener).toHaveFocus();
  });

  it("reports Escape and backdrop closes through the same contract", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();

    render(<DialogHarness onClose={onClose} />);
    const opener = screen.getByRole("button", { name: "Open dialog" });
    await user.click(opener);
    fireEvent(
      screen.getByRole("dialog"),
      new Event("cancel", { bubbles: false, cancelable: true }),
    );
    expect(onClose).toHaveBeenLastCalledWith("escape");

    await user.click(opener);
    fireEvent.click(screen.getByRole("dialog"));
    expect(onClose).toHaveBeenLastCalledWith("backdrop");
  });

  it("blocks every close path while a mutation is busy", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();

    render(<DialogHarness closeDisabled onClose={onClose} />);
    await user.click(screen.getByRole("button", { name: "Open dialog" }));
    const dialog = screen.getByRole("dialog");
    fireEvent(dialog, new Event("cancel", { cancelable: true }));
    fireEvent.click(dialog);
    expect(screen.getByRole("button", { name: "Close" })).toBeDisabled();
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("tabs primitive", () => {
  it("supports wrapping arrows plus Home and End with roving tabindex", async () => {
    const user = userEvent.setup();

    function Harness() {
      const [value, setValue] = useState<"first" | "second" | "third">(
        "first",
      );
      return (
        <Tabs
          ariaLabel="Sections"
          items={[
            { value: "first", label: "First", controls: "first-panel" },
            { value: "second", label: "Second", controls: "second-panel" },
            { value: "third", label: "Third", controls: "third-panel" },
          ]}
          onChange={setValue}
          value={value}
        />
      );
    }

    render(<Harness />);
    const first = screen.getByRole("tab", { name: "First" });
    const second = screen.getByRole("tab", { name: "Second" });
    const third = screen.getByRole("tab", { name: "Third" });
    expect(first).toHaveAttribute("aria-controls", "first-panel");

    first.focus();
    await user.keyboard("{ArrowLeft}");
    expect(third).toHaveFocus();
    expect(third).toHaveAttribute("tabindex", "0");

    await user.keyboard("{Home}");
    expect(first).toHaveFocus();
    await user.keyboard("{ArrowRight}");
    expect(second).toHaveFocus();
    await user.keyboard("{End}");
    expect(third).toHaveFocus();
  });
});

describe("help tooltip primitive", () => {
  it("connects help text only while the top-layer popover is open", async () => {
    const user = userEvent.setup();

    render(<HelpTip label="Range help">Range explanation</HelpTip>);
    const trigger = screen.getByRole("button", { name: "Range help" });
    const tooltip = screen.getByText("Range explanation");

    await user.tab();
    await waitFor(() => expect(trigger).toHaveAttribute("aria-describedby"));
    expect(tooltip).toHaveAttribute("data-popover-open");

    await user.keyboard("{Escape}");
    await waitFor(() =>
      expect(trigger).not.toHaveAttribute("aria-describedby"),
    );
    expect(tooltip).not.toHaveAttribute("data-popover-open");

    fireEvent.click(trigger);
    await waitFor(() => expect(tooltip).toHaveAttribute("data-popover-open"));
    fireEvent.click(trigger);
    await waitFor(() =>
      expect(tooltip).not.toHaveAttribute("data-popover-open"),
    );
  });

  it("keeps the tooltip inside narrow viewport edges", () => {
    expect(
      computeTooltipPosition({
        tooltipHeight: 80,
        triggerBottom: 32,
        triggerLeft: 2,
        triggerTop: 12,
        triggerWidth: 20,
        viewportHeight: 240,
        viewportWidth: 180,
      }),
    ).toEqual({ left: 8, top: 39, width: 164 });

    expect(
      computeTooltipPosition({
        tooltipHeight: 80,
        triggerBottom: 220,
        triggerLeft: 160,
        triggerTop: 200,
        triggerWidth: 20,
        viewportHeight: 240,
        viewportWidth: 180,
      }),
    ).toEqual({ left: 8, top: 113, width: 164 });
  });
});
