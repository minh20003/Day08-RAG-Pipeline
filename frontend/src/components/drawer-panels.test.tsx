import { fireEvent, render } from "@testing-library/react";
import type { RefObject } from "react";
import { describe, expect, it, vi } from "vitest";
import { Sidebar } from "./Sidebar";
import { SourcePanel } from "./SourcePanel";
import type { SourceDocument } from "../types";

function setDrawerMediaQuery(matches: boolean) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string): MediaQueryList => ({
      matches,
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }),
  });
}

const source: SourceDocument = {
  id: "source-1",
  title: "Student handbook",
  category: "LEGAL",
  score: 0.92,
  method: "Hybrid",
  excerpt: "Verified source.",
  content: "Verified source.",
  year: 2026,
  verified: true,
  chunks: 3,
  indexedAt: "2026-08-01T00:00:00.000Z",
};

describe("drawer panels", () => {
  it("shows factual verification and PageIndex state", () => {
    setDrawerMediaQuery(false);
    const { getByText } = render(
      <SourcePanel
        backendStatus="degraded"
        isOpen={false}
        pageIndexHealth={{ status: "waiting", detail: "Indexer is warming up" }}
        selectedSourceId={source.id}
        sources={[source]}
        onClose={vi.fn()}
        onSelect={vi.fn()}
      />,
    );

    expect(getByText("Đã xác minh")).toBeTruthy();
    expect(getByText("PageIndex đang chờ")).toBeTruthy();
  });

  it("closes drawers with Escape and restores trigger focus", () => {
    setDrawerMediaQuery(true);
    const sourceTrigger = document.createElement("button");
    document.body.append(sourceTrigger);
    const sourceTriggerRef = { current: sourceTrigger } as RefObject<HTMLButtonElement>;
    const closeSources = vi.fn();

    const { getByLabelText, rerender } = render(
      <SourcePanel
        backendStatus="ready"
        isOpen
        pageIndexHealth={{ status: "ready", detail: "Ready" }}
        returnFocusRef={sourceTriggerRef}
        selectedSourceId={null}
        sources={[]}
        onClose={closeSources}
        onSelect={vi.fn()}
      />,
    );

    fireEvent.keyDown(document, { key: "Escape" });
    expect(closeSources).toHaveBeenCalledTimes(1);
    rerender(
      <SourcePanel
        backendStatus="ready"
        isOpen={false}
        pageIndexHealth={{ status: "ready", detail: "Ready" }}
        returnFocusRef={sourceTriggerRef}
        selectedSourceId={null}
        sources={[]}
        onClose={closeSources}
        onSelect={vi.fn()}
      />,
    );
    expect(sourceTrigger).toBe(document.activeElement);
    expect(getByLabelText("Nguồn tham khảo").getAttribute("aria-hidden")).toBe("true");

    const menuTrigger = document.createElement("button");
    document.body.append(menuTrigger);
    const menuTriggerRef = { current: menuTrigger } as RefObject<HTMLButtonElement>;
    const closeMenu = vi.fn();
    const { unmount } = render(
      <Sidebar
        activeView="assistant"
        conversations={[]}
        isOpen
        returnFocusRef={menuTriggerRef}
        onClose={closeMenu}
        onConversationSelect={vi.fn()}
        onNewChat={vi.fn()}
        onViewChange={vi.fn()}
      />,
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(closeMenu).toHaveBeenCalledTimes(1);
    unmount();
    sourceTrigger.remove();
    menuTrigger.remove();
  });
});
