// Original doodle wallpaper for the chat background, generated once as an SVG tile.
const DOODLES: string[] = [
  // chat bubble
  '<path d="M5 7h22a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H13l-6 5v-5H5a3 3 0 0 1-3-3V10a3 3 0 0 1 3-3z"/><path d="M8 13h16M8 17h10"/>',
  // star
  '<path d="M16 3l3.8 8 8.7 1-6.4 6 1.7 8.6L16 22.4 8.2 26.6 9.9 18 3.5 12l8.7-1z"/>',
  // heart
  '<path d="M16 27S4 19.5 4 11.5A6 6 0 0 1 16 9a6 6 0 0 1 12 2.5C28 19.5 16 27 16 27z"/>',
  // gear
  '<circle cx="16" cy="16" r="4.5"/><circle cx="16" cy="16" r="9.5"/><path d="M16 3.5v3M16 25.5v3M3.5 16h3M25.5 16h3M7.2 7.2l2.1 2.1M22.7 22.7l2.1 2.1M7.2 24.8l2.1-2.1M22.7 9.3l2.1-2.1"/>',
  // paw
  '<path d="M16 17c-4 0-8 4-8 7.5 0 2.5 2.5 3 4 2.5 1.5-.5 2.5-1 4-1s2.5.5 4 1c1.5.5 4 0 4-2.5 0-3.5-4-7.5-8-7.5z"/><ellipse cx="8" cy="12" rx="2.3" ry="3"/><ellipse cx="13" cy="7.5" rx="2.3" ry="3"/><ellipse cx="19" cy="7.5" rx="2.3" ry="3"/><ellipse cx="24" cy="12" rx="2.3" ry="3"/>',
  // scissors
  '<circle cx="9" cy="24" r="4"/><circle cx="23" cy="24" r="4"/><path d="M11.5 21 23 4M20.5 21 9 4"/>',
  // tooth
  '<path d="M9 5c3 0 4 2 7 2s4-2 7-2c4 0 6 4 5 9-1 4-2 5-2.5 9-.4 3-1.5 5-3 5-2 0-2-7-4.5-7S14 28 12 28c-1.5 0-2.6-2-3-5-.5-4-1.5-5-2.5-9C5.5 9 5 5 9 5z"/>',
  // leaf
  '<path d="M6 26C6 12 14 5 27 5c0 13-7 21-21 21zM6 26 18 14"/>',
  // coffee cup
  '<path d="M6 12h16v8a6 6 0 0 1-6 6h-4a6 6 0 0 1-6-6zM22 14h2a3 3 0 0 1 0 6h-2M11 4c-1 2 1 3 0 5M16 4c-1 2 1 3 0 5"/>',
  // crab
  '<ellipse cx="16" cy="19" rx="8" ry="5.5"/><path d="M9 16 5 12M23 16l4-4"/><circle cx="5" cy="10" r="2.6"/><circle cx="27" cy="10" r="2.6"/><path d="M13 14v-3M19 14v-3M9 22l-4 2M10 24l-3 3M23 22l4 2M22 24l3 3"/>',
  // wrench
  '<path d="M20 4a6 6 0 0 0-5.5 8.2L5 21.7a2.3 2.3 0 0 0 3.3 3.3l9.5-9.5A6 6 0 0 0 26 10l-3.5 3.5-3-.5-.5-3L22.5 6.5A6 6 0 0 0 20 4z"/>',
  // clock
  '<circle cx="16" cy="16" r="11"/><path d="M16 9v7l5 3"/>',
  // music note
  '<path d="M12 24V7l14-3v17"/><circle cx="9" cy="24" r="3"/><circle cx="23" cy="21" r="3"/>',
  // sparkle
  '<path d="M16 4c1 7 5 11 12 12-7 1-11 5-12 12-1-7-5-11-12-12 7-1 11-5 12-12z"/>',
  // car
  '<path d="M4 21v-5l3.5-6h14l5 6h1.5v5z"/><circle cx="10" cy="21.5" r="2.8"/><circle cx="23" cy="21.5" r="2.8"/><path d="M9 15.5h14"/>',
  // comb
  '<path d="M4 10h24v4H4zM7 14v9M11 14v9M15 14v9M19 14v9M23 14v9"/>',
  // phone
  '<path d="M10 3h12a2 2 0 0 1 2 2v22a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM14 25h4"/>',
  // calendar
  '<rect x="4" y="7" width="24" height="20" rx="3"/><path d="M4 13h24M10 4v6M22 4v6M10 18h3M16 18h3M22 18h1M10 22h3"/>',
  // smile
  '<circle cx="16" cy="16" r="11"/><path d="M11 18.5c2.8 3 7.2 3 10 0"/><path d="M12 12.5v1M20 12.5v1"/>',
  // moon
  '<path d="M24 20A10 10 0 0 1 12.5 6 10 10 0 1 0 24 20z"/>',
];

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function tile(stroke: string): string {
  const size = 420;
  const cells = 7;
  const step = size / cells;
  const r = rng(7);
  let body = '';
  let k = 0;
  for (let row = 0; row < cells; row++) {
    for (let col = 0; col < cells; col++) {
      const d = DOODLES[(k * 7 + row * 3) % DOODLES.length]!;
      k++;
      const x = col * step + step / 2 + (r() - 0.5) * 18;
      const y = row * step + step / 2 + (r() - 0.5) * 18;
      const rot = Math.round((r() - 0.5) * 60);
      const sc = (0.78 + r() * 0.3).toFixed(2);
      body += `<g transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${rot}) scale(${sc}) translate(-16 -16)">${d}</g>`;
    }
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><g fill="none" stroke="${stroke}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${body}</g></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

let installed = false;

/** Publishes the wallpaper tiles as CSS custom properties on the root element. */
export function installWallpaper(): void {
  if (installed) return;
  installed = true;
  const root = document.documentElement.style;
  root.setProperty('--wall-img-light', tile('rgba(120, 100, 70, 0.16)'));
  root.setProperty('--wall-img-dark', tile('rgba(255, 255, 255, 0.045)'));
}
