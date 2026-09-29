// QA pass, part 2: every UI control in the browser against the live QA server.
import { test, expect, type Page } from '@playwright/test';
import path from 'node:path';
import { ROOT, T, phone } from './helpers.ts';

// Sequential (workers: 1) but independent: one failure must not skip the rest of the QA sweep.

const CONV_ITEM = '[data-testid^="owner-conversation-"]:not([data-testid="owner-conversation-list"])';

async function asCustomer(page: Page, name: string, tenant: string = T.oficina): Promise<string> {
  const ph = phone();
  await page.addInitScript(
    ([p, n, t]) => {
      if (!sessionStorage.getItem('qa.init')) {
        localStorage.setItem('kani.customer', JSON.stringify({ phone: p, name: n }));
        localStorage.setItem('kani.tenant', t);
        sessionStorage.setItem('qa.init', '1');
      }
    },
    [ph, name, tenant],
  );
  return ph;
}

async function sendText(page: Page, text: string): Promise<void> {
  await page.getByTestId('composer-input').fill(text);
  await page.getByTestId('composer-input').press('Enter');
}

const bot = (page: Page) => page.locator('[data-testid="message"][data-role="assistant"]');

test('U01 composer: Enter sends, Shift+Enter makes a newline, mic swaps to send button', async ({ page }) => {
  await asCustomer(page, 'QA Composer');
  await page.goto('/');
  await expect(page.getByTestId('mic-button')).toBeVisible();
  const input = page.getByTestId('composer-input');
  await input.fill('linha 1');
  await expect(page.getByTestId('send-button')).toBeVisible();
  await input.press('Shift+Enter');
  await input.pressSequentially('linha 2');
  await expect(input).toHaveValue('linha 1\nlinha 2');
  await input.press('Enter');
  await expect(page.locator('[data-testid="message"][data-role="customer"]').last()).toContainText('linha 2');
  await expect(input).toHaveValue('');
  await expect(bot(page).last()).toBeVisible({ timeout: 120_000 });
});

test('U02 emoji picker inserts at the cursor', async ({ page }) => {
  await asCustomer(page, 'QA Emoji');
  await page.goto('/');
  await page.getByTestId('composer-input').fill('oi ');
  await page.getByTestId('emoji-button').click();
  await expect(page.getByTestId('emoji-picker')).toBeVisible();
  await page.getByTestId('emoji-picker').locator('button').first().click();
  const v = await page.getByTestId('composer-input').inputValue();
  expect(v.startsWith('oi ')).toBe(true);
  expect(v.length).toBeGreaterThan(3);
});

test('U03 XSS: HTML in messages renders as text, never executes', async ({ page }) => {
  let dialog = false;
  page.on('dialog', async (d) => {
    dialog = true;
    await d.dismiss();
  });
  await asCustomer(page, 'QA XSS');
  await page.goto('/');
  await sendText(page, '<img src=x onerror=alert(1)><script>alert(2)</script> oi');
  const mine = page.locator('[data-testid="message"][data-role="customer"]').last();
  await expect(mine).toContainText('<img src=x onerror=alert(1)>');
  await expect(mine.locator('img')).toHaveCount(0);
  await expect(bot(page).last()).toBeVisible({ timeout: 120_000 });
  await page.getByTestId('nav-owner').click();
  await page.locator(CONV_ITEM, { hasText: 'QA XSS' }).first().click();
  await expect(page.locator('[data-testid="message"]').first()).toBeVisible();
  expect(dialog).toBe(false);
});

test('U04 photo: preview with caption, bubble, lightbox open/close, vision in owner view', async ({ page }) => {
  await asCustomer(page, 'QA Lightbox', T.pet);
  await page.goto('/');
  await page.getByTestId('file-input-image').setInputFiles(path.join(ROOT, 'fixtures/images/pet.png'));
  await page.getByTestId('image-preview-caption').fill('olha isso');
  await page.getByTestId('image-preview-send').click();
  const img = page.locator('[data-testid="message"][data-type="image"]').last();
  await expect(img).toContainText('olha isso');
  await img.locator('img').first().click();
  await expect(page.getByTestId('lightbox')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('lightbox')).toBeHidden();
  await expect(bot(page).last()).toBeVisible({ timeout: 200_000 });
  await page.getByTestId('nav-owner').click();
  await page.locator(CONV_ITEM, { hasText: 'QA Lightbox' }).first().click();
  await expect(page.getByTestId('vision-description').first()).not.toContainText(/Describing/i, { timeout: 60_000 });
});

test('U05 mic recording with a fake microphone: recorder bar, cancel, record and send', async ({ page }) => {
  await asCustomer(page, 'QA Mic', T.salao);
  await page.goto('/');
  await page.getByTestId('mic-button').click();
  await expect(page.getByTestId('recorder')).toBeVisible();
  await page.getByTestId('record-cancel').click();
  await expect(page.getByTestId('recorder')).toBeHidden();
  await expect(page.locator('[data-testid="message"][data-type="audio"]')).toHaveCount(0);
  await page.getByTestId('mic-button').click();
  await expect(page.getByTestId('recorder')).toBeVisible();
  await page.waitForTimeout(2500);
  await page.getByTestId('recorder').getByTestId('send-button').click();
  const audio = page.locator('[data-testid="message"][data-type="audio"]').last();
  await expect(audio).toBeVisible();
  await expect(audio.getByTestId('audio-player')).toBeVisible();
  await expect(audio).toContainText(/0:0[1-9]/);
  // The fake device plays a beep: whisperX finds no speech and the bot still answers.
  await expect(bot(page).last()).toBeVisible({ timeout: 200_000 });
});

test('U06 voice note upload: player plays and shows duration; transcript in owner view', async ({ page }) => {
  await asCustomer(page, 'QA Player');
  await page.goto('/');
  await page.getByTestId('file-input-audio').setInputFiles(path.join(ROOT, 'fixtures/audio/voice-note-oficina.ogg'));
  const audio = page.locator('[data-testid="message"][data-type="audio"]').last();
  await expect(audio).toContainText(/0:0[5-9]/);
  const play = audio.getByRole('button', { name: 'Reproduzir' });
  await play.click();
  await expect(audio.getByRole('button', { name: 'Pausar' })).toBeVisible();
  await audio.getByRole('button', { name: 'Pausar' }).click();
  await expect(bot(page).last()).toBeVisible({ timeout: 200_000 });
  await page.getByTestId('nav-owner').click();
  await page.locator(CONV_ITEM, { hasText: 'QA Player' }).first().click();
  await expect(page.getByTestId('transcript').first()).toContainText(/barulho/i);
});

test('U07 profile edit changes the WhatsApp name the business sees', async ({ page }) => {
  await asCustomer(page, 'QA Antes');
  await page.goto('/');
  await page.getByRole('button', { name: 'Menu', exact: true }).first().click();
  await page.getByTestId('menu-profile').click();
  await page.getByTestId('profile-name').fill('QA Depois');
  await page.getByTestId('profile-save').click();
  await sendText(page, 'oi, voces abrem sabado?');
  await expect(bot(page).last()).toBeVisible({ timeout: 120_000 });
  await page.getByTestId('nav-owner').click();
  await expect(page.locator(CONV_ITEM, { hasText: 'QA Depois' }).first()).toBeVisible();
});

test('U08 "Limpar conversa" wipes the thread and the chat still works', async ({ page }) => {
  await asCustomer(page, 'QA Limpar', T.estetica);
  await page.goto('/');
  await sendText(page, 'oi, quanto custa a drenagem?');
  await expect(bot(page).last()).toBeVisible({ timeout: 120_000 });
  await page.getByTestId('menu-button').click();
  await page.getByTestId('menu-clear').click();
  await expect(page.locator('[data-testid="message"]')).toHaveCount(0);
  await sendText(page, 'oi de novo');
  await expect(bot(page).last()).toBeVisible({ timeout: 120_000 });
  await expect(bot(page).last()).toContainText(/virtual/i);
});

test('U09 theme toggle cycles auto -> light -> dark and persists', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');
  const html = page.locator('html');
  await expect(html).toHaveAttribute('data-theme', 'dark');
  await page.getByTestId('theme-toggle').click();
  await expect(html).toHaveAttribute('data-theme', 'light');
  await page.getByTestId('theme-toggle').click();
  await expect(html).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(html).toHaveAttribute('data-theme', 'dark');
  expect(await page.evaluate(() => localStorage.getItem('kani.theme'))).toBe('dark');
});

test('U10 unread badge counts bot/owner messages on a chat that is not open', async ({ page, request }) => {
  const ph = await asCustomer(page, 'QA Badge', T.oficina);
  await page.goto('/');
  // Create the pet conversation for this customer, then switch away from it.
  await page.getByTestId(`chat-item-${T.pet}`).click();
  await sendText(page, 'oi');
  await expect(bot(page).last()).toBeVisible({ timeout: 120_000 });
  await page.getByTestId(`chat-item-${T.oficina}`).click();
  const convs = await (await request.get(`/api/conversations?tenantId=${T.pet}`)).json();
  const mine = convs.find((c: { contact: { phone: string } }) => c.contact.phone === ph);
  await request.post(`/api/conversations/${mine.id}/owner-messages`, { data: { text: 'Oi! Aqui e o Lucas do Pet Care.' } });
  await expect(page.getByTestId(`chat-item-${T.pet}`).locator('.unread-badge')).toHaveText('1');
  await page.getByTestId(`chat-item-${T.pet}`).click();
  await expect(page.getByTestId(`chat-item-${T.pet}`).locator('.unread-badge')).toHaveCount(0);
});

test('U11 owner info panel: appointment Done sends the review request into the thread', async ({ page, request }) => {
  await asCustomer(page, 'QA Painel', T.salao);
  await page.goto('/');
  await sendText(page, 'quero agendar uma sobrancelha amanha de manha');
  await expect(bot(page).last()).toBeVisible({ timeout: 120_000 });
  // Pick the first offered time until an appointment exists.
  for (let i = 0; i < 5; i++) {
    const convs = await (await request.get(`/api/conversations?tenantId=${T.salao}`)).json();
    const conv = convs.find((c: { contact: { waName: string } }) => c.contact.waName === 'QA Painel');
    const d = await (await request.get(`/api/conversations/${conv.id}`)).json();
    if (d.appointments.some((a: { status: string }) => a.status === 'booked')) break;
    const last = (await bot(page).last().textContent()) ?? '';
    const t = last.match(/\b\d{1,2}(:\d{2}|h\d{0,2})/);
    const count = await bot(page).count();
    await sendText(page, t ? `pode ser ${t[0]}` : /confirm|posso/i.test(last) ? 'sim' : 'meu nome e QA Painel, pode ser qualquer horario');
    await expect(bot(page)).toHaveCount(count + 1, { timeout: 120_000 });
  }
  await page.getByTestId('nav-owner').click();
  await page.locator(CONV_ITEM, { hasText: 'QA Painel' }).first().click();
  const appt = page.locator('[data-testid^="appointment-"]').first();
  await expect(appt).toBeVisible();
  await appt.getByRole('button', { name: 'Done' }).click();
  await expect(page.locator('[data-testid="message"][data-role="assistant"]').last()).toContainText('g.page', { timeout: 120_000 });
});

test('U12 escalation banner, resolve, take over / resume through the UI', async ({ page }) => {
  await asCustomer(page, 'QA Banner', T.odonto);
  await page.goto('/');
  await sendText(page, 'quero falar com um atendente');
  await expect(bot(page).last()).toBeVisible({ timeout: 60_000 });
  await page.getByTestId('nav-owner').click();
  await page.locator(CONV_ITEM, { hasText: 'QA Banner' }).first().click();
  await expect(page.getByTestId('escalation-banner')).toBeVisible();
  await expect(page.getByTestId('owner-status')).toHaveText(/Human/);
  await expect(page.getByTestId('owner-composer-input')).toBeEnabled();
  await page.getByTestId('resolve-escalation-button').click();
  await expect(page.getByTestId('escalation-banner')).toBeHidden();
  await page.getByTestId('resume-button').click();
  await expect(page.getByTestId('owner-status')).toHaveText(/Bot/);
  await expect(page.getByTestId('owner-composer-input')).toBeDisabled();
  await page.getByTestId('takeover-button').click();
  await expect(page.getByTestId('owner-status')).toHaveText(/Human/);
});

test('U13 live updates survive a proxy that buffers SSE (polling fallback)', async ({ page }) => {
  await page.route('**/api/events', () => {
    /* never answer: simulates a proxy holding the stream */
  });
  await asCustomer(page, 'QA Polling', T.pet);
  await page.goto('/');
  await sendText(page, 'oi, quanto ta o corte de unhas?');
  await expect(page.locator('[data-testid="message"][data-role="customer"]').last()).toHaveAttribute('data-status', 'read', { timeout: 30_000 });
  await expect(bot(page).last()).toContainText('30', { timeout: 120_000 });
});

test('U14 admin: metrics, tenant filter, report links, time travel buttons', async ({ page, request }) => {
  await page.goto('/admin');
  await expect(page.getByTestId('admin-page')).toBeVisible();
  const before = await page.getByTestId('metric-conversationsHandled').textContent();
  await page.getByTestId('admin-tenant-select').selectOption(T.pet);
  await expect(page.getByTestId('metric-conversationsHandled')).not.toHaveText(before ?? '');
  await page.getByTestId('admin-tenant-select').selectOption('all');
  const links = page.getByTestId('admin-reports').locator('a');
  expect(await links.count()).toBeGreaterThan(0);
  for (const href of (await links.evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).getAttribute('href')))).slice(0, 5)) {
    expect((await request.get(href!)).status(), href!).toBe(200);
  }
  const clock0 = (await (await request.get('/api/dev/clock')).json()).offsetHours;
  await page.getByTestId('time-travel-1h').click();
  await expect.poll(async () => (await (await request.get('/api/dev/clock')).json()).offsetHours).toBe(clock0 + 1);
  await expect(page.getByTestId('server-clock')).toBeVisible();
});

test('U15 layout: no horizontal overflow at 1280, 1440 and 1920 widths; no console errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  for (const width of [1280, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    for (const url of ['/', '/admin']) {
      await page.goto(url);
      await page.waitForTimeout(800);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, `${url} at ${width}`).toBeLessThanOrEqual(0);
    }
  }
  expect(errors.filter((e) => !/favicon/i.test(e)), errors.join('\n')).toEqual([]);
});

test('U16 phone layout (375px): list and conversation one at a time, back button, owner view too', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await asCustomer(page, 'QA Mobile', T.pet);
  await page.goto('/');
  await expect(page.getByTestId('chat-list')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  await page.getByTestId(`chat-item-${T.pet}`).click();
  await expect(page.getByTestId('chat-list')).toBeHidden();
  await expect(page.getByTestId('composer-input')).toBeVisible();
  const box = await page.getByTestId('composer-input').boundingBox();
  expect(box!.width).toBeGreaterThan(150);
  await sendText(page, 'oi, quanto ta o banho porte pequeno?');
  await expect(bot(page).last()).toContainText('60', { timeout: 120_000 });
  await page.getByTestId('mobile-back').click();
  await expect(page.getByTestId('chat-list')).toBeVisible();
  await page.getByTestId('nav-owner').click();
  await page.locator(CONV_ITEM, { hasText: 'QA Mobile' }).first().click();
  await expect(page.getByTestId('owner-status')).toBeVisible();
  await expect(page.getByTestId('owner-conversation-list')).toBeHidden();
  await page.getByTestId('mobile-back').click();
  await expect(page.getByTestId('owner-conversation-list')).toBeVisible();
  await page.goto('/admin');
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
});
