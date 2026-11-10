/**
 * @file Community.test.tsx
 * @description Board states of the distributed task board on the Community page: the claim button is disabled with a visible reason while a dependency is open, the stale badge marks abandoned claimed tasks, the conflict badge names the holder, the release dialog previews the handover comment from the API and posts the note, and the plan-sync preview lists create/update counts and only POSTs after the confirm button.
 * @author Caglar Ulkuderner
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act, screen, fireEvent, within, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import i18n from "i18next";

// Mutable per-test payloads read by the cockpit mock below.
let configData: Record<string, unknown> | null = null;
let boardData: Record<string, unknown> | null = null;
let planPreviewData: Record<string, unknown> | null = null;

vi.mock("../../lib/cockpit", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    cockpit: {
      communityConfig: vi.fn(() => Promise.resolve(configData)),
      communitySave: vi.fn(() => Promise.resolve(configData)),
      communityBoard: vi.fn(() => Promise.resolve(boardData)),
      communityMembers: vi.fn(() => Promise.resolve({ provider: "github", members: [] })),
      communityDirs: vi.fn(),
      communityClaim: vi.fn(),
      communityReleasePreview: vi.fn(() =>
        Promise.resolve({
          comment:
            "Yarıda kaldı. Dal: task/11-birakirken-not-yaz. Son commit: feat: wt list. Not: test notu",
        })
      ),
      communityRelease: vi.fn(() => Promise.resolve({ ok: true })),
      communityPlanSyncPreview: vi.fn(() => Promise.resolve(planPreviewData)),
      communityPlanSync: vi.fn(() =>
        Promise.resolve({ created: [50], updated: [14], skipped: [] })
      ),
      communityPrPreview: vi.fn(),
      communityOpenPr: vi.fn(),
    },
  };
});

import Community from "../Community";
import { cockpit } from "../../lib/cockpit";

/** Minimal task fixture; overrides replace the D1 board fields under test. */
function task(o: Record<string, unknown> = {}) {
  return {
    number: 1,
    title: "Görev",
    url: null,
    body: "",
    assignees: [] as string[],
    area: [] as string[],
    deps: [] as number[],
    acceptance: [] as string[],
    estimate_ms: null,
    branch: "task/1-gorev",
    state: "open",
    claimed_at: null,
    updated_at: "2026-11-04T06:00:00Z",
    pr: null,
    blocked_by: [] as number[],
    conflicts_with: [] as number[],
    ready: true,
    stale: false,
    last_activity_at: null as string | null,
    ...o,
  };
}

/** Minimal board payload around the given tasks. */
function boardOf(tasks: Array<ReturnType<typeof task>>, ready = 0) {
  return {
    provider: "github",
    review_name: "PR",
    me: "tester",
    tasks,
    done: [],
    progress: { done: 0, total: tasks.length, ratio: tasks.length ? 0 : null },
    totals: {
      open: tasks.filter((x) => x.state === "open").length,
      mine: tasks.filter((x) => x.state === "mine").length,
      taken: tasks.filter((x) => x.state === "taken").length,
      review: tasks.filter((x) => x.state === "review").length,
      ready,
      open_estimate_ms: 0,
      open_unestimated: 0,
    },
  };
}

const CFG = {
  provider: "github",
  localPath: "/Users/tester/repo",
  repo: "ekip/repo",
  label: "cockpit-task",
  planFile: "docs/plan.md",
};

async function settle() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
  });
}

async function renderCommunity() {
  render(
    <MemoryRouter initialEntries={["/community"]}>
      <Community />
    </MemoryRouter>
  );
  await settle();
}

beforeEach(() => {
  i18n.changeLanguage("tr");
  configData = CFG;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("Community board — D1 task states", () => {
  it("disables claim with the reason for a blocked task", async () => {
    boardData = boardOf([task({ number: 3, state: "open", ready: false, blocked_by: [2] })]);
    await renderCommunity();
    const btn = await screen.findByRole("button", { name: /Al ve başlat/ });
    expect(btn).toBeDisabled();
    expect(screen.getByText(/Bekliyor: #2/)).toBeInTheDocument();
  });

  it("shows the stale badge", async () => {
    boardData = boardOf([
      task({
        number: 1,
        state: "mine",
        assignees: ["tester"],
        claimed_at: "2026-11-04T06:00:00Z",
        stale: true,
        last_activity_at: "2026-11-04T06:00:00Z",
      }),
    ]);
    await renderCommunity();
    expect(await screen.findByText(/Sahipsiz kalmış/)).toBeInTheDocument();
  });

  it("conflict badge shows the holder name", async () => {
    boardData = boardOf([
      task({
        number: 7,
        state: "taken",
        assignees: ["deniz"],
        area: ["server/lib/**"],
        claimed_at: "2026-11-04T06:00:00Z",
      }),
      task({
        number: 8,
        state: "open",
        ready: false,
        conflicts_with: [7],
        area: ["server/lib/community.js"],
      }),
    ]);
    await renderCommunity();
    expect(await screen.findByText(/Çakışma: #7 \(deniz\)/)).toBeInTheDocument();
  });

  it("release dialog shows the preview comment and posts the note", async () => {
    boardData = boardOf([
      task({
        number: 11,
        state: "mine",
        assignees: ["tester"],
        claimed_at: "2026-11-04T06:00:00Z",
      }),
    ]);
    await renderCommunity();
    await act(async () => {
      screen.getByRole("button", { name: "Bırak" }).click();
    });
    await settle();
    const dialog = screen.getByRole("dialog");
    expect(await within(dialog).findByText(/Yarıda kaldı/)).toBeInTheDocument();
    const confirm = within(dialog).getByRole("button", { name: "Bırak ve yorumu yaz" });
    const note = within(dialog).getByLabelText(/Devralacak kişiye not/) as HTMLTextAreaElement;
    await act(async () => {
      fireEvent.change(note, { target: { value: "test notu" } });
    });
    // The shown preview is for the old note: confirm waits for the new one.
    expect(confirm).toBeDisabled();
    await waitFor(() => expect(confirm).toBeEnabled());
    expect(cockpit.communityReleasePreview).toHaveBeenLastCalledWith(11, "test notu");
    await act(async () => {
      confirm.click();
    });
    await settle();
    expect(cockpit.communityRelease).toHaveBeenCalledWith(11, "test notu");
  });

  it("plan-sync preview lists create/update counts and calls POST only after the confirm button", async () => {
    boardData = boardOf([task({ number: 14, state: "open" })]);
    planPreviewData = {
      create: [
        { id: "5", title: "Görev brief'i" },
        { id: "6", title: "Planı tahtaya aç" },
      ],
      update: [{ id: "1", title: "Görev alanları", number: 14 }],
    };
    await renderCommunity();
    await act(async () => {
      screen.getByRole("button", { name: "Planı tahtaya aç" }).click();
    });
    await settle();
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Açılacak (2)")).toBeInTheDocument();
    expect(within(dialog).getByText("Güncellenecek (1)")).toBeInTheDocument();
    expect(cockpit.communityPlanSync).not.toHaveBeenCalled();
    await act(async () => {
      within(dialog).getByRole("button", { name: "Onayla ve aç (3)" }).click();
    });
    await settle();
    expect(cockpit.communityPlanSync).toHaveBeenCalledTimes(1);
  });

  it("plan sync names the issues it skipped for lacking the board label", async () => {
    boardData = boardOf([task({ number: 14, state: "open" })]);
    planPreviewData = { create: [], update: [{ id: "1", title: "Görev alanları", number: 99 }] };
    vi.mocked(cockpit.communityPlanSync).mockResolvedValueOnce({
      created: [],
      updated: [],
      skipped: [99],
    });
    await renderCommunity();
    await act(async () => {
      screen.getByRole("button", { name: "Planı tahtaya aç" }).click();
    });
    await settle();
    const dialog = screen.getByRole("dialog");
    await act(async () => {
      within(dialog).getByRole("button", { name: "Onayla ve aç (1)" }).click();
    });
    await settle();
    const after = screen.getByRole("dialog");
    expect(within(after).getByText(/güncellenmedi: #99/)).toBeInTheDocument();
    // The stale preview cannot be confirmed again; the board reloads behind the dialog.
    expect(within(after).queryByRole("button", { name: /Onayla ve aç/ })).toBeNull();
    expect(within(after).getByRole("button", { name: "Kapat" })).toBeInTheDocument();
    expect(vi.mocked(cockpit.communityBoard).mock.calls.length).toBeGreaterThan(1);
    await act(async () => {
      fireEvent.keyDown(window, { key: "Escape" });
    });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
