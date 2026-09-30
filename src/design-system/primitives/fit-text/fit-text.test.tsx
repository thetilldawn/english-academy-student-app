/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { fittedFontSize, FitText, FitTextGroup } from "./fit-text";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("실제 폭 기준 단어 표시", () => {
  it.each([1,2])("확대 배율%s에서도 같은 CSS 폭은 같은 글자 크기를 유지한다", scale => {
    vi.spyOn(HTMLElement.prototype,"clientWidth","get").mockReturnValue(200);
    vi.spyOn(HTMLElement.prototype,"offsetWidth","get").mockReturnValue(200);
    vi.spyOn(window,"getComputedStyle").mockImplementation(node=>({fontSize:node===document.documentElement?'16px':'30px'}) as CSSStyleDeclaration);
    vi.spyOn(HTMLElement.prototype,"getBoundingClientRect").mockImplementation(function(this:HTMLElement){return {width:(this.hasAttribute('data-fit-text')?200:300)*scale} as DOMRect;});
    const view=render(<FitText>responsibility</FitText>);
    expect(view.container.querySelector<HTMLElement>('[data-fit-text]')!.style.getPropertyValue('--fit-size')).toBe('20px');
  });
  it("짧은 단어는 키우지 않고 넘치는 단어만 줄인다", () => {
    expect(fittedFontSize(25, 200, 100, 14)).toBe(25);
    expect(fittedFontSize(25, 120, 200, 14)).toBe(15);
    expect(fittedFontSize(25, 20, 500, 14)).toBe(14);
    expect(fittedFontSize(25, 0, 0, 14)).toBe(25);
  });
  it("원문과 강세 구조를 한 번만 보존하고 별도 문구를 넣지 않는다", () => {
    render(<FitTextGroup><FitText group="word">responsibility</FitText><FitText>[퍼<strong>텐</strong>셜]</FitText></FitTextGroup>);
    expect(screen.getAllByText("responsibility")).toHaveLength(1);
    expect(screen.getByText("텐").tagName).toBe("STRONG");
  });

  it("네 보기의 크기를 맞추고 폭이 바뀌면 재계산한다", () => {
    let available = 300;
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(() => available);
    vi.spyOn(window, "getComputedStyle").mockImplementation(node => ({
      fontSize: node === document.documentElement ? "16px" : "20px",
    }) as CSSStyleDeclaration);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      return { width: this.textContent === "responsibility" ? 400 : 100 } as DOMRect;
    });
    const view = render(<FitTextGroup>{["responsibility", "take", "word", "keep"].map(word => <FitText key={word} group="choices">{word}</FitText>)}</FitTextGroup>);
    const sizes = () => [...view.container.querySelectorAll<HTMLElement>("[data-fit-text]")].map(node => node.style.getPropertyValue("--fit-size"));
    expect(sizes()).toEqual(["15px", "15px", "15px", "15px"]);
    available = 450;
    act(() => window.dispatchEvent(new Event("resize")));
    expect(sizes()).toEqual(["20px", "20px", "20px", "20px"]);
    available = 50;
    act(() => window.dispatchEvent(new Event("resize")));
    expect(sizes()).toEqual(["14px", "14px", "14px", "14px"]);
  });

  it("넓이가 아직0인 항목도 나타난 뒤 맞추고 확대된 최소 글꼴보다 작게 줄이지 않는다", () => {
    let available = 0;
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(() => available);
    vi.spyOn(window, "getComputedStyle").mockImplementation(node => ({
      fontSize: node === document.documentElement ? "32px" : "40px",
    }) as CSSStyleDeclaration);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ width: 800 } as DOMRect);
    const view = render(<FitText>take responsibility for</FitText>);
    const box = view.container.querySelector<HTMLElement>("[data-fit-text]")!;
    expect(box.style.getPropertyValue("--fit-size")).toBe("");
    available = 100;
    act(() => window.dispatchEvent(new Event("resize")));
    expect(box.style.getPropertyValue("--fit-size")).toBe("28px");
    expect(box.textContent).toBe("take responsibility for");
  });
});
