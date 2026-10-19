import type { Locator, Page } from "@playwright/test";
import { expect, test } from "../support/fixtures";
import { gotoAppShell } from "../support/helpers/app";
import { daemonWsRoutePattern } from "../support/helpers/daemon-port";
import { getServerId } from "../support/helpers/server-id";
import { seedWorkspace } from "../support/helpers/seed-client";

interface SessionEnvelope {
  type?: string;
  message?: { type?: string; requestId?: string };
}

function readSessionRequest(raw: string): SessionEnvelope["message"] {
  try {
    const envelope: SessionEnvelope = JSON.parse(raw);
    return envelope.type === "session" ? envelope.message : undefined;
  } catch {
    return undefined;
  }
}

async function installStatusAssignmentFailure(page: Page) {
  let failNext = false;
  await page.routeWebSocket(daemonWsRoutePattern(), (browser) => {
    const server = browser.connectToServer();
    browser.onMessage((message) => {
      const raw = typeof message === "string" ? message : message.toString("utf8");
      const request = readSessionRequest(raw);
      if (
        failNext &&
        request?.type === "workspace.status.assignment.set.request" &&
        request.requestId
      ) {
        failNext = false;
        browser.send(
          JSON.stringify({
            type: "session",
            message: {
              type: "rpc_error",
              payload: {
                requestId: request.requestId,
                requestType: request.type,
                error: "Injected status assignment failure.",
                code: "handler_error",
              },
            },
          }),
        );
        return;
      }
      server.send(message);
    });
    server.onMessage((message) => browser.send(message));
  });
  return {
    failNext() {
      failNext = true;
    },
  };
}

function column(page: Page, id: string): Locator {
  return page.getByTestId(`kanban-column-${id}`);
}

/** dnd-kit starts a drag only after the pointer travels, so the move is walked in steps. */
async function dragTo(page: Page, source: Locator, target: Locator) {
  const from = await source.boundingBox();
  if (!from) throw new Error("expected the dragged element to be visible");
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2 + 12, from.y + from.height / 2, { steps: 4 });
  const to = await target.boundingBox();
  if (!to) throw new Error("expected the drop target to be visible");
  await page.mouse.move(to.x + to.width / 2, to.y + Math.min(to.height / 2, 200), { steps: 12 });
  await page.mouse.up();
}

async function columnOrder(page: Page): Promise<string[]> {
  return page.locator('[data-testid^="kanban-column-"]').evaluateAll((elements) =>
    elements
      .map((element) => element.getAttribute("data-testid") ?? "")
      .filter(
        (id) => !id.startsWith("kanban-column-menu-") && !id.startsWith("kanban-column-move-"),
      )
      .map((id) => id.slice("kanban-column-".length)),
  );
}

test.describe("Workspace kanban", () => {
  test.describe.configure({ timeout: 180_000 });

  test("moves cards between status columns and keeps the column order", async ({ page }) => {
    const seeded = await seedWorkspace({ repoPrefix: "workspace-kanban-", title: "Kanban card" });
    try {
      const { status: blocked } = await seeded.client.createWorkspaceStatus({
        name: "Blocked",
        color: "red",
      });
      const readManualStatus = async () => {
        const { entries } = await seeded.client.fetchWorkspaces();
        return entries.find((entry) => entry.id === seeded.workspaceId)?.manualStatus ?? null;
      };
      const failure = await installStatusAssignmentFailure(page);
      // Wide enough for all five columns, so no drag has to scroll the kanban.
      await page.setViewportSize({ width: 2000, height: 900 });
      await gotoAppShell(page);
      await page.locator('[data-testid="sidebar-kanban"]:visible').click();
      await expect(page).toHaveURL(/\/kanban$/);

      const card = page.getByTestId(`kanban-card-${getServerId()}:${seeded.workspaceId}`);
      await expect(column(page, "backlog").getByText("Kanban card")).toBeVisible({
        timeout: 30_000,
      });
      // Every column shows, empty ones included, so each one can take a drop.
      await expect(column(page, "in_review")).toContainText("No workspaces");

      await test.step("dropping a card on a custom column pins that status", async () => {
        await dragTo(page, card, column(page, "custom:blocked"));
        await expect(column(page, "custom:blocked").getByText("Kanban card")).toBeVisible();
        await expect.poll(readManualStatus).toEqual({ statusId: blocked.id, baseline: "backlog" });
      });

      await test.step("dropping it back on its automatic column clears the pin", async () => {
        await dragTo(page, card, column(page, "backlog"));
        await expect(column(page, "backlog").getByText("Kanban card")).toBeVisible();
        await expect.poll(readManualStatus).toBeNull();
      });

      await test.step("a rejected move puts the card back and says why", async () => {
        failure.failNext();
        await dragTo(page, card, column(page, "done"));
        await expect(page.getByText("Unable to update status")).toBeVisible();
        await expect(column(page, "backlog").getByText("Kanban card")).toBeVisible();
        await expect(column(page, "done").getByText("Kanban card")).toBeHidden();
        expect(await readManualStatus()).toBeNull();
      });

      await test.step("columns move from their menu and drag by their header", async () => {
        await page.getByTestId("kanban-column-menu-done").click();
        await page.getByTestId("kanban-column-move-left-done").click();
        await expect
          .poll(columnOrder.bind(null, page))
          .toEqual(["in_review", "in_progress", "done", "backlog", "custom:blocked"]);

        await dragTo(
          page,
          column(page, "custom:blocked").getByText("Blocked", { exact: true }),
          column(page, "in_review"),
        );
        await expect
          .poll(columnOrder.bind(null, page))
          .toEqual(["custom:blocked", "in_review", "in_progress", "done", "backlog"]);
      });

      await test.step("the column order survives a reload", async () => {
        await page.reload();
        await expect(column(page, "backlog").getByText("Kanban card")).toBeVisible({
          timeout: 30_000,
        });
        expect(await columnOrder(page)).toEqual([
          "custom:blocked",
          "in_review",
          "in_progress",
          "done",
          "backlog",
        ]);
      });
    } finally {
      await seeded.cleanup();
    }
  });
});
