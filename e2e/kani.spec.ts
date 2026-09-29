// End-to-end: real server, real Ollama (qwen3:8b + gemma3:12b vision), real whisperX.
import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = path.join(ROOT, 'reports/screenshots');
mkdirSync(SHOTS, { recursive: true });
const OFICINA = 'oficina-vila-mariana';
const SALAO = 'salao-pinheiros';

async function asCustomer(page: Page, name: string, tenant = OFICINA): Promise<void> {
  const phone = `+55 11 95${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`;
  await page.addInitScript(
    ([p, n, t]) => {
      localStorage.setItem('kani.customer', JSON.stringify({ phone: p, name: n }));
      localStorage.setItem('kani.tenant', t);
    },
    [phone, name, tenant],
  );
}

/** Full-page screenshots in light and dark. */
async function shoot(page: Page, name: string): Promise<void> {
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.evaluate((s) => {
      localStorage.setItem('kani.theme', s);
      document.documentElement.setAttribute('data-theme', s);
    }, scheme);
    await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(SHOTS, `${name}-${scheme}.png`), fullPage: true });
  }
  await page.evaluate(() => localStorage.setItem('kani.theme', 'auto'));
}

async function openOwnerConversation(page: Page, customerName: string): Promise<void> {
  await page.getByTestId('nav-owner').click();
  const item = page.locator('[data-testid^="owner-conversation-"]', { hasText: customerName }).first();
  await expect(item).toBeVisible({ timeout: 30_000 });
  await item.click();
}

test('customer sends text and gets a grounded bot reply (ticks turn blue)', async ({ page }) => {
  await asCustomer(page, 'E2E Texto');
  await page.goto('/');
  await page.getByTestId(`chat-item-${OFICINA}`).click();
  await expect(page.getByTestId('chat-header-title')).toContainText('Auto Center Vila Mariana');
  await page.getByTestId('composer-input').fill('boa noite, qnto ta a troca de oleo?');
  await page.getByTestId('composer-input').press('Enter');
  const mine = page.locator('[data-testid="message"][data-role="customer"]').last();
  await expect(mine).toContainText('troca de oleo');
  await expect(mine).toHaveAttribute('data-status', 'read', { timeout: 30_000 });
  const bot = page.locator('[data-testid="message"][data-role="assistant"]').last();
  await expect(bot).toBeVisible({ timeout: 90_000 });
  await expect(bot).toContainText('180');
  await expect(bot).toContainText(/assistente virtual/i);
  await shoot(page, 'chat');
});

test('voice note upload is transcribed by whisperX and answered', async ({ page }) => {
  await asCustomer(page, 'E2E Audio');
  await page.goto('/');
  await page.getByTestId(`chat-item-${OFICINA}`).click();
  await page.getByTestId('file-input-audio').setInputFiles(path.join(ROOT, 'fixtures/audio/voice-note-oficina.m4a'));
  await expect(page.locator('[data-testid="message"][data-type="audio"]').last()).toBeVisible();
  await expect(page.locator('[data-testid="message"][data-role="assistant"]').last()).toBeVisible({ timeout: 180_000 });
  await shoot(page, 'chat-voice');
  await openOwnerConversation(page, 'E2E Audio');
  await expect(page.getByTestId('transcript').first()).toContainText(/barulho/i, { timeout: 30_000 });
  await shoot(page, 'owner-voice-transcript');
});

test('photo upload goes through real vision (gemma3) and shows in the owner view', async ({ page }) => {
  await asCustomer(page, 'E2E Foto');
  await page.goto('/');
  await page.getByTestId(`chat-item-${OFICINA}`).click();
  await page.getByTestId('file-input-image').setInputFiles(path.join(ROOT, 'fixtures/images/oficina.png'));
  await expect(page.getByTestId('image-preview')).toBeVisible();
  await page.getByTestId('image-preview-caption').fill('olha isso, o freio ta assim');
  await page.getByTestId('image-preview-send').click();
  await expect(page.locator('[data-testid="message"][data-type="image"]').last()).toBeVisible();
  await expect(page.locator('[data-testid="message"][data-role="assistant"]').last()).toBeVisible({ timeout: 200_000 });
  await openOwnerConversation(page, 'E2E Foto');
  const vision = page.getByTestId('vision-description').first();
  await expect(vision).toBeVisible();
  await expect(vision).not.toContainText(/Describing/i, { timeout: 30_000 });
  await shoot(page, 'owner-vision');
});

test('owner TAKE OVER pauses the bot, owner reply reaches the customer, RESUME re-enables', async ({ page }) => {
  await asCustomer(page, 'E2E Owner');
  await page.goto('/');
  await page.getByTestId(`chat-item-${OFICINA}`).click();
  await page.getByTestId('composer-input').fill('oi, voces trabalham com cartao?');
  await page.getByTestId('composer-input').press('Enter');
  await expect(page.locator('[data-testid="message"][data-role="assistant"]').last()).toBeVisible({ timeout: 90_000 });
  await openOwnerConversation(page, 'E2E Owner');
  await expect(page.getByTestId('owner-status')).toHaveText(/Bot/);
  await page.getByTestId('takeover-button').click();
  await expect(page.getByTestId('owner-status')).toHaveText(/Human/);
  await page.getByTestId('owner-composer-input').fill('Oi! Aqui e o Marcos, dono da oficina. Aceitamos cartao sim!');
  await page.getByTestId('owner-send-button').click();
  await expect(page.locator('[data-testid="message"][data-role="owner"]').last()).toContainText('Marcos');
  await shoot(page, 'owner-takeover');
  await page.getByTestId('nav-customer').click();
  await expect(page.locator('[data-testid="message"]').last()).toContainText('Marcos');
  await page.getByTestId('nav-owner').click();
  await page.locator('[data-testid^="owner-conversation-"]', { hasText: 'E2E Owner' }).first().click();
  await page.getByTestId('resume-button').click();
  await expect(page.getByTestId('owner-status')).toHaveText(/Bot/);
});

test('escalation banner appears when the customer asks for a human', async ({ page }) => {
  await asCustomer(page, 'E2E Escala');
  await page.goto('/');
  await page.getByTestId(`chat-item-${OFICINA}`).click();
  await page.getByTestId('composer-input').fill('quero falar com um atendente humano');
  await page.getByTestId('composer-input').press('Enter');
  await expect(page.locator('[data-testid="message"][data-role="assistant"]').last()).toBeVisible({ timeout: 30_000 });
  await openOwnerConversation(page, 'E2E Escala');
  await expect(page.getByTestId('escalation-banner')).toBeVisible();
  await expect(page.getByTestId('owner-status')).toHaveText(/Human/);
  await shoot(page, 'owner-escalation');
  await page.getByTestId('resolve-escalation-button').click();
  await expect(page.getByTestId('escalation-banner')).toBeHidden();
});

test('tenant switch changes the chat and the owner inbox', async ({ page }) => {
  await asCustomer(page, 'E2E Switch');
  await page.goto('/');
  await page.getByTestId(`chat-item-${SALAO}`).click();
  await expect(page.getByTestId('chat-header-title')).toContainText('Studio Bela Pinheiros');
  await page.getByTestId('chat-item-pet-perdizes').click();
  await expect(page.getByTestId('chat-header-title')).toContainText('Pet Care Perdizes');
  await page.getByTestId('nav-owner').click();
  await expect(page.getByTestId('owner-tenant-select')).toContainText('Pet Care Perdizes');
  await expect(page.getByTestId('owner-conversation-list')).toBeVisible();
  await shoot(page, 'owner-inbox');
});

test('/admin renders the weekly metrics and report links', async ({ page }) => {
  await page.goto('/admin');
  await expect(page.getByTestId('admin-page')).toBeVisible();
  await expect(page.getByTestId('metric-conversationsHandled')).toBeVisible();
  await expect(page.getByTestId('metric-conversationsHandled')).not.toContainText(/^\s*0\s*$/);
  await expect(page.getByTestId('metric-bookingsCreated')).toBeVisible();
  await expect(page.getByTestId('admin-reports')).toBeVisible();
  await page.getByTestId('admin-tenant-select').selectOption('oficina-vila-mariana');
  await expect(page.getByTestId('metric-quotesApproved')).toBeVisible();
  await page.getByTestId('admin-tenant-select').selectOption('all');
  await shoot(page, 'admin');
});
