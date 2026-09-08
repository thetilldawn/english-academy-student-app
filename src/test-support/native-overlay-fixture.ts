import { afterEach, beforeEach, vi } from "vitest";

/** jsdom lacks the browser's native top layer. This fixture does not simulate layout. */
export function installNativeOverlayFixture() {
  let restore: () => void;
  beforeEach(() => {
    const definitions = [
      [HTMLDialogElement.prototype, "showModal", function (this: HTMLDialogElement) { this.setAttribute("open", ""); }],
      [HTMLDialogElement.prototype, "close", function (this: HTMLDialogElement) { this.removeAttribute("open"); }],
      [HTMLElement.prototype, "showPopover", function (this: HTMLElement) { this.setAttribute("data-popover-open", ""); this.dispatchEvent(new Event("toggle")); }],
      [HTMLElement.prototype, "hidePopover", function (this: HTMLElement) { this.removeAttribute("data-popover-open"); this.dispatchEvent(new Event("toggle")); }],
    ] as const;
    const originals = definitions.map(([prototype, key]) => Object.getOwnPropertyDescriptor(prototype, key));
    definitions.forEach(([prototype, key, value]) => Object.defineProperty(prototype, key, { configurable: true, writable: true, value }));
    const matches = Element.prototype.matches;
    const matchesMock = vi.spyOn(Element.prototype, "matches").mockImplementation(function (this: Element, selector: string) {
      return selector === ":popover-open" ? this.hasAttribute("data-popover-open") : matches.call(this, selector);
    });
    restore = () => {
      matchesMock.mockRestore();
      definitions.forEach(([prototype, key], index) => {
        const descriptor = originals[index];
        if (descriptor) Object.defineProperty(prototype, key, descriptor);
        else Reflect.deleteProperty(prototype, key);
      });
    };
  });
  afterEach(() => restore?.());
}
