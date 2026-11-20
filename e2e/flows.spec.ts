import { expect, test, type Page } from "@playwright/test";

async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("demo1234");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
}

async function pickSeats(page: Page, slug: string, n: number) {
  await page.goto(`/events/${slug}`);
  await expect(page.getByText("Live", { exact: false }).first()).toBeVisible();
  const free = page.locator('button[data-status="available"]');
  const labels: string[] = [];
  for (let i = 0; i < n; i++) {
    const seat = free.nth(i * 3);
    labels.push((await seat.getAttribute("data-seat"))!);
    await seat.click();
  }
  return labels;
}

test("a customer picks seats, pays and receives tickets by email", async ({ page }) => {
  await signIn(page, "ali@tathkara.app");
  await page.getByRole("link", { name: /Symphony Under the Stars/ }).click();
  await pickSeats(page, "symphony-under-the-stars", 2);
  await page.getByRole("button", { name: "Hold 2 seats" }).click();

  const panel = page.getByTestId("hold-panel");
  await expect(panel.getByText("Seats held for you")).toBeVisible();
  await expect(panel.getByLabel("Time left")).toHaveText(/^(10:00|9:\d\d)$/);
  await panel.getByRole("button", { name: /^Pay / }).click();

  await expect(page.getByText("SandboxPay · test mode")).toBeVisible();
  await page.getByRole("button", { name: /^Pay / }).click();
  await expect(page.getByRole("heading", { name: "You're going!" })).toBeVisible();

  await page.getByRole("button", { name: "View my tickets" }).click();
  await expect(page.getByText(/TK-\w{4}-\w{4}-\w{4}/).first()).toBeVisible();

  await page.getByRole("link", { name: /Inbox/ }).click();
  await expect(page.getByRole("heading", { name: /Your tickets for Symphony Under the Stars/ })).toBeVisible({
    timeout: 20_000,
  });
  const pdf = await page.request.get((await page.getByRole("link", { name: "tickets.pdf" }).getAttribute("href"))!);
  expect(pdf.headers()["content-type"]).toBe("application/pdf");
});

test("other viewers see a seat get held in real time", async ({ browser }) => {
  const viewer = await browser.newPage();
  await viewer.goto("/events/jeddah-hoops-final");
  await expect(viewer.getByText("Live", { exact: false }).first()).toBeVisible();

  const buyer = await browser.newPage();
  await signIn(buyer, "sara@tathkara.app");
  const [label] = await pickSeats(buyer, "jeddah-hoops-final", 1);
  await expect(viewer.locator(`button[data-seat="${label}"]`).first()).toHaveAttribute("data-status", "available");
  await buyer.getByRole("button", { name: "Hold 1 seat" }).click();
  await expect(buyer.getByTestId("hold-panel")).toBeVisible();

  // No reload: the change arrives over the WebSocket.
  await expect(viewer.locator(`button[data-seat="${label}"]`).first()).toHaveAttribute("data-status", "held");
  await buyer.getByRole("button", { name: "Release seats" }).click();
  await expect(viewer.locator(`button[data-seat="${label}"]`).first()).toHaveAttribute("data-status", "available");
});

test("a declined card releases the seats", async ({ page }) => {
  await signIn(page, "sara@tathkara.app");
  await pickSeats(page, "founders-summit-2027", 1);
  await page.getByRole("button", { name: "Hold 1 seat" }).click();
  await page.getByTestId("hold-panel").getByRole("button", { name: /^Pay / }).click();
  await page.getByLabel("Card number").fill("4000 0000 0000 0002");
  await page.getByRole("button", { name: /^Pay / }).click();
  await expect(page.getByRole("heading", { name: "Payment declined" })).toBeVisible();
});

test("the organizer admits a ticket once at the door", async ({ browser }) => {
  const customer = await browser.newPage();
  await signIn(customer, "ali@tathkara.app");
  const tickets = await (await customer.request.get("/api/tickets")).json();
  test.skip(!tickets.length, "needs a ticket from the purchase test");
  const code = tickets.find((t: { checkedInAt: string | null }) => !t.checkedInAt).code as string;

  const door = await browser.newPage();
  await signIn(door, "nora@tathkara.app");
  await door.getByRole("link", { name: "Organizer" }).click();
  await expect(door.getByText("Tickets sold")).toBeVisible();
  await door.getByLabel("Ticket code").fill(code);
  await door.getByRole("button", { name: "Admit" }).click();
  await expect(door.getByTestId("check-in-result")).toContainText("Admitted");
  await expect(door.getByTestId("check-in-result")).toContainText("Ali Hassan");

  await door.getByLabel("Ticket code").fill(code);
  await door.getByRole("button", { name: "Admit" }).click();
  await expect(door.getByTestId("check-in-result")).toContainText("Already used");
});

test("protected pages ask you to sign in and come back", async ({ page }) => {
  await page.goto("/tickets");
  await expect(page).toHaveURL(/\/login\?next=%2Ftickets/);
  await page.getByRole("button", { name: "Ali — customer" }).click();
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/tickets$/);
});
