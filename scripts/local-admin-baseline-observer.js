// Served only by the loopback baseline proxy; never part of the application bundle.
(() => {
  if (location.origin !== "http://127.0.0.1:3037") return;
  let pending = { kind: "initial", route: location.pathname, started: 0 };
  let scheduled = false;
  const listReady = () => {
    const main = document.querySelector("main");
    return main && !main.querySelector('[aria-busy="true"]') &&
      (main.innerText.includes("가짜 학생 1") || main.innerText.includes("조건에 맞는 학생이 없습니다.") ||
        (location.pathname === "/admin/results" && main.innerText.includes("조건에 맞는 내역이 없습니다.")));
  };
  const ready = () => {
    if (!pending) return false;
    const dialog = document.querySelector("dialog[open]");
    if (pending.kind === "modal-open") return dialog?.innerText.includes("시험 범위") && !dialog.querySelector('[aria-busy="true"]');
    if (pending.kind === "modal-close") return !dialog && listReady();
    if (pending.route !== location.pathname || !listReady()) return false;
    const heading = document.querySelector("h1")?.textContent;
    if (heading !== ({ "/admin/students": "학생", "/admin/assignments": "배정", "/admin/results": "내역" })[pending.route]) return false;
    if (pending.kind === "filter") {
      const text = document.querySelector("main").innerText;
      return pending.query ? text.includes("1명") && !text.includes("가짜 학생 2") : text.includes("2명");
    }
    return true;
  };
  function observe() {
    if (!pending || scheduled || !ready()) return;
    scheduled = true;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      scheduled = false;
      if (!pending || !ready()) return;
      const result = { kind: pending.kind, route: pending.route,
        durationMs: performance.now() - pending.started, at: Date.now() };
      pending = null;
      void fetch("/__baseline/observe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(result) });
    }));
  }
  function begin(kind, route = location.pathname, query = "") {
    pending = { kind, route, query, started: performance.now() };
    observe();
  }
  document.addEventListener("click", event => {
    const element = event.target instanceof Element ? event.target : null;
    const link = element?.closest("a[href]");
    if (link && ["/admin/students", "/admin/assignments", "/admin/results"].includes(link.getAttribute("href"))) {
      begin("link", link.getAttribute("href")); return;
    }
    const button = element?.closest("button");
    if (button?.textContent.trim() === "단어 배정") begin("modal-open");
    if (button?.textContent.trim() === "닫기" && button.closest("dialog[open]")) begin("modal-close");
  }, true);
  document.addEventListener("input", event => {
    if (event.target instanceof HTMLInputElement && event.target.type === "search" && !event.target.closest("dialog")) {
      begin("filter", location.pathname, event.target.value.trim());
    }
  }, true);
  window.addEventListener("popstate", () => begin("history"));
  new MutationObserver(observe).observe(document.documentElement, { childList: true, subtree: true, attributes: true, characterData: true });
  observe();
})();
