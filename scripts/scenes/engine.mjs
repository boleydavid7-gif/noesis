// Noesis's scene kit: the Proairetos family's flat-illustration kit (layered ridges, firs on the ridge line, sky,
// mist, still water with reflections, a few foreground things) in a richer cut. One light at LAMP_X with its faint
// ring as in every family scene, no clouds and no second sun or moon; each ridge is shaded from a lit crest to a
// darker foot and catches the light along its top on the light's side; mist is a soft band with no edge; the
// picture has a gentle vignette and a fine grain. The files are drawn at twice their size and scaled down, so every
// edge is smooth. Everything is seeded so it redraws the same.

export function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

export function ridgeFn(w, h, base, amp, seed, detail = 1, peaks = 0) {
  const r = rng(seed);
  const waves = Array.from({ length: 5 }, (_, i) => ({ f: (0.6 + r() * 1.4) * (i + 1) * detail, p: r() * Math.PI * 2, a: amp / (i + 1.3) }));
  const spikes = Array.from({ length: peaks }, () => ({ x: r(), a: amp * (1 + r() * 1.4), s: 0.07 + r() * 0.08 }));
  return (x) => {
    let y = base;
    for (const v of waves) y += Math.sin((x / w) * Math.PI * 2 * v.f + v.p) * v.a;
    for (const s of spikes) {
      const d = Math.abs(x / w - s.x) / s.s;
      if (d < 1) y -= s.a * (Math.cos(Math.PI * d) + 1) / 2;
    }
    return y * h;
  };
}

export function ridgePath(w, h, f) {
  const pts = [];
  for (let step = 0; step <= 200; step++) {
    const x = (w * step) / 200;
    pts.push(`${x.toFixed(1)},${f(x).toFixed(1)}`);
  }
  return `M0,${h} L${pts.join(' L')} L${w},${h} Z`;
}

export function firsOn(w, f, seed, size, count, sink = 0.15) {
  const r = rng(seed);
  let d = '';
  for (let i = 0; i < count; i++) {
    const x = r() * w;
    const s = size * (0.55 + r() * 0.9);
    const y = f(x) + s * sink;
    const t = s * 1.6;
    d += `M${(x - s * 0.34).toFixed(1)},${y.toFixed(1)} L${(x - s * 0.12).toFixed(1)},${(y - t * 0.45).toFixed(1)} L${(x - s * 0.24).toFixed(1)},${(y - t * 0.45).toFixed(1)} L${x.toFixed(1)},${(y - t).toFixed(1)} L${(x + s * 0.24).toFixed(1)},${(y - t * 0.45).toFixed(1)} L${(x + s * 0.12).toFixed(1)},${(y - t * 0.45).toFixed(1)} L${(x + s * 0.34).toFixed(1)},${y.toFixed(1)} Z `;
  }
  return d;
}

export function stars(w, h, seed, n, maxY) {
  const r = rng(seed);
  let s = '';
  for (let i = 0; i < n; i++) s += `<circle cx="${(r() * w).toFixed(1)}" cy="${(r() * h * maxY).toFixed(1)}" r="${(0.5 + r() * 1.3).toFixed(2)}" fill="#fff" opacity="${(0.2 + r() * 0.6).toFixed(2)}"/>`;
  return s;
}

export function clouds(w, h, seed, n, y0, y1, color, opacity, size = 1) {
  const r = rng(seed);
  let s = '';
  for (let i = 0; i < n; i++) {
    const cx = r() * w;
    const cy = h * (y0 + r() * (y1 - y0));
    const m = Math.min(w, h);
    const cw = m * (0.3 + r() * 0.35) * size;
    const ch = cw * (0.09 + r() * 0.04);
    s += `<g opacity="${(opacity * (0.6 + r() * 0.4)).toFixed(2)}" fill="${color}">`;
    s += `<rect x="${(cx - cw / 2).toFixed(1)}" y="${(cy - ch / 2).toFixed(1)}" width="${cw.toFixed(1)}" height="${ch.toFixed(1)}" rx="${(ch / 2).toFixed(1)}"/>`;
    s += `<circle cx="${(cx - cw * 0.12).toFixed(1)}" cy="${(cy - ch * 0.35).toFixed(1)}" r="${(ch * 0.75).toFixed(1)}"/>`;
    s += `<circle cx="${(cx + cw * 0.1).toFixed(1)}" cy="${(cy - ch * 0.5).toFixed(1)}" r="${(ch * 0.95).toFixed(1)}"/>`;
    s += `</g>`;
  }
  return s;
}

export const defs = `<filter id="grain"><feTurbulence type="fractalNoise" baseFrequency="1.1" numOctaves="2" stitchTiles="stitch"/><feColorMatrix values="0 0 0 0 0.5 0 0 0 0 0.5 0 0 0 0 0.5 0 0 0 0.055 0"/></filter><filter id="blur" x="-0.2" y="-2" width="1.4" height="5"><feGaussianBlur stdDeviation="18"/></filter><filter id="soft" x="-1" y="-1" width="3" height="3"><feGaussianBlur stdDeviation="3"/></filter><filter id="glowblur" x="-1" y="-1" width="3" height="3"><feGaussianBlur stdDeviation="8"/></filter><filter id="rimblur" x="-0.05" y="-0.5" width="1.1" height="2"><feGaussianBlur stdDeviation="1.6"/></filter><filter id="mirror" x="-0.05" y="-0.2" width="1.1" height="1.4"><feGaussianBlur stdDeviation="3 6"/></filter>`;

/*
 * Lamplight's one light. Every scene in the family is lit by a single light at the same place across the picture
 * (LAMP_X, as the wallpaper's lamp and the icons' are upper right), at the height of that scene's horizon, with one
 * faint ring around it as the wallpaper and the icons have. No clouds, no second sun or moon.
 */
export const LAMP_X = 0.64;

export function lampRing(x, y, m, color, opacity = 0.22) {
  return `<circle cx="${x}" cy="${y}" r="${(m * 0.13).toFixed(1)}" fill="none" stroke="${color}" stroke-opacity="${opacity}" stroke-width="${Math.max(1.5, m * 0.004).toFixed(1)}"/>`;
}

/** The light itself: a soft bright core, the disc and its ring. */
export function lamp(x, y, m, r, color, glowColor) {
  const id = `core${Math.round(x)}${Math.round(y)}`;
  return `<defs><radialGradient id="${id}" cx="${x}" cy="${y}" r="${m * r * 4}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#fff" stop-opacity=".55"/><stop offset=".25" stop-color="${glowColor}" stop-opacity=".35"/><stop offset="1" stop-color="${glowColor}" stop-opacity="0"/></radialGradient></defs><circle cx="${x}" cy="${y}" r="${m * r * 4}" fill="url(#${id})"/><circle cx="${x}" cy="${y}" r="${m * r}" fill="${color}"/>${lampRing(x, y, m, glowColor)}`;
}

const channels = (hex) => [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16));
/** `from` moved toward `to` by `amount` (0 to 1). */
export function mixHex(from, to, amount) {
  const a = channels(from);
  const b = channels(to);
  return `#${a.map((v, i) => Math.round(v + (b[i] - v) * amount).toString(16).padStart(2, '0')).join('')}`;
}

export function sky(id, stops) {
  return `<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">${stops.map(([o, c]) => `<stop offset="${o}" stop-color="${c}"/>`).join('')}</linearGradient>`;
}

export function glow(id, cx, cy, r, color, strength = 0.9) {
  return `<radialGradient id="${id}" cx="${cx}" cy="${cy}" r="${r}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${color}" stop-opacity="${strength}"/><stop offset="0.14" stop-color="${color}" stop-opacity="${strength * 0.55}"/><stop offset="0.5" stop-color="${color}" stop-opacity="${strength * 0.12}"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></radialGradient>`;
}

let mists = 0;
/** A soft band of mist: clear at both edges, thickest in its middle, no hard line anywhere. */
export function mist(w, y, height, color, opacity) {
  const id = `mist${mists++}`;
  return `<defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity="0"/><stop offset=".5" stop-color="${color}" stop-opacity="${opacity}"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs><rect x="0" y="${(y - height).toFixed(1)}" width="${w}" height="${(height * 3).toFixed(1)}" fill="url(#${id})"/>`;
}

/** Still water from y down: a gradient, a glitter path under the sun, and soft lines. */
export function water(w, h, y, stops, sunX, glint, seed = 5) {
  const r = rng(seed);
  let s = `<defs>${sky('waterg', stops)}</defs><rect x="0" y="${y}" width="${w}" height="${h - y}" fill="url(#waterg)"/>`;
  if (glint) {
    s += `<rect x="${sunX - w * 0.035}" y="${y}" width="${w * 0.07}" height="${(h - y) * 0.6}" fill="${glint}" opacity="0.3" filter="url(#blur)"/>`;
    for (let i = 0; i < 16; i++) {
      const ly = y + (h - y) * (0.02 + i * 0.035);
      const lw = w * (0.04 + i * 0.012) * (0.7 + r() * 0.6);
      s += `<rect x="${(sunX - lw / 2 + (r() - 0.5) * w * 0.01).toFixed(1)}" y="${ly.toFixed(1)}" width="${lw.toFixed(1)}" height="${Math.max(1.5, h * 0.0018).toFixed(1)}" rx="1" fill="${glint}" opacity="${Math.max(0.08, 0.55 - i * 0.03).toFixed(2)}"/>`;
    }
  }
  for (let i = 0; i < 10; i++) {
    const ly = y + (h - y) * r();
    const lx = r() * w;
    s += `<rect x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" width="${(w * (0.05 + r() * 0.12)).toFixed(1)}" height="${Math.max(1, h * 0.0012).toFixed(1)}" fill="#fff" opacity="0.08"/>`;
  }
  return s;
}

/** A ridge mirrored below the waterline, faint. */
export function reflection(w, h, f, y, color, opacity) {
  const pts = [];
  for (let step = 0; step <= 200; step++) {
    const x = (w * step) / 200;
    const dy = y - f(x);
    pts.push(`${x.toFixed(1)},${(y + dy * 0.8).toFixed(1)}`);
  }
  return `<path d="M0,${y} L${pts.join(' L')} L${w},${y} Z" fill="${color}" opacity="${opacity}" filter="url(#mirror)"/>`;
}

/** Rounded boulders along the foreground. */
export function rocks(w, h, seed, n, y0, size, colors) {
  const r = rng(seed);
  let s = '';
  for (let i = 0; i < n; i++) {
    const cx = r() * w * 1.1 - w * 0.05;
    const cy = h * (y0 + r() * (1 - y0));
    const rw = size * (0.6 + r() * 0.9);
    const rh = rw * (0.45 + r() * 0.25);
    const c = colors[i % colors.length];
    s += `<path d="M${cx - rw},${cy + rh * 0.3} Q${cx - rw * 0.9},${cy - rh} ${cx - rw * 0.1},${cy - rh * 1.05} Q${cx + rw * 0.8},${cy - rh * 0.9} ${cx + rw},${cy + rh * 0.3} Z" fill="${c}"/>`;
    s += `<path d="M${cx - rw * 0.55},${cy - rh * 0.55} Q${cx - rw * 0.1},${cy - rh * 0.95} ${cx + rw * 0.35},${cy - rh * 0.75}" stroke="#fff" stroke-opacity="0.12" stroke-width="${Math.max(2, rw * 0.06)}" fill="none" stroke-linecap="round"/>`;
  }
  return s;
}

/** A leafy branch hanging in from an edge (olive or similar). */
export function branch(x, y, len, angle, seed, leaf, color, stem) {
  const r = rng(seed);
  const rad = (angle * Math.PI) / 180;
  const ex = x + Math.cos(rad) * len;
  const ey = y + Math.sin(rad) * len;
  const mx = (x + ex) / 2 + Math.sin(rad) * len * 0.12;
  const my = (y + ey) / 2 - Math.cos(rad) * len * 0.12;
  let s = `<path d="M${x},${y} Q${mx},${my} ${ex},${ey}" stroke="${stem}" stroke-width="${leaf * 0.12}" fill="none" stroke-linecap="round"/>`;
  for (let i = 1; i <= 16; i++) {
    const t = i / 17;
    const px = (1 - t) * (1 - t) * x + 2 * (1 - t) * t * mx + t * t * ex;
    const py = (1 - t) * (1 - t) * y + 2 * (1 - t) * t * my + t * t * ey;
    const side = i % 2 ? 1 : -1;
    const a = angle + side * (35 + r() * 25);
    const l = leaf * (0.75 + r() * 0.5) * (1 - t * 0.35);
    s += `<ellipse cx="${(px + Math.cos((a * Math.PI) / 180) * l * 0.5).toFixed(1)}" cy="${(py + Math.sin((a * Math.PI) / 180) * l * 0.5).toFixed(1)}" rx="${(l * 0.5).toFixed(1)}" ry="${(l * 0.14).toFixed(1)}" transform="rotate(${a.toFixed(1)} ${(px + Math.cos((a * Math.PI) / 180) * l * 0.5).toFixed(1)} ${(py + Math.sin((a * Math.PI) / 180) * l * 0.5).toFixed(1)})" fill="${color[i % color.length]}"/>`;
  }
  return s;
}

export function svg(w, h, extraDefs, body) {
  const vignette = `<radialGradient id="vig" cx="${w * 0.55}" cy="${h * 0.45}" r="${Math.max(w, h) * 0.75}" gradientUnits="userSpaceOnUse"><stop offset=".55" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".28"/></radialGradient>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><defs>${defs}${vignette}${extraDefs}</defs>${body}<rect width="${w}" height="${h}" fill="url(#vig)"/><rect width="${w}" height="${h}" filter="url(#grain)"/></svg>`;
}

/** The top line of a ridge, open, for the light along it. */
export function ridgeTop(w, f) {
  const pts = [];
  for (let step = 0; step <= 200; step++) {
    const x = (w * step) / 200;
    pts.push(`${x.toFixed(1)},${f(x).toFixed(1)}`);
  }
  return `M${pts.join(' L')}`;
}

/** A ridge shaded from its crest (a little of the light's color in it) to a darker foot, with light along its top. */
export function litRidge(w, h, f, i, layer, glowColor, lampX, rim) {
  const top = h * (layer.base - Math.abs(layer.amp) * 2 - (layer.peaks ? layer.amp * 2 : 0));
  const crest = mixHex(layer.color, glowColor, layer.lit ?? 0.14);
  const foot = mixHex(layer.color, '#000000', 0.18);
  const id = `ridge${i}`;
  let s = `<defs><linearGradient id="${id}" x1="0" y1="${top.toFixed(1)}" x2="0" y2="${h}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${crest}"/><stop offset=".45" stop-color="${layer.color}"/><stop offset="1" stop-color="${foot}"/></linearGradient>`;
  s += `<linearGradient id="${id}rim" x1="0" y1="0" x2="${w}" y2="0" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${glowColor}" stop-opacity="0"/><stop offset="${Math.max(0, lampX / w - 0.38).toFixed(3)}" stop-color="${glowColor}" stop-opacity="0"/><stop offset="${(lampX / w).toFixed(3)}" stop-color="${glowColor}" stop-opacity="${rim}"/><stop offset="${Math.min(1, lampX / w + 0.38).toFixed(3)}" stop-color="${glowColor}" stop-opacity="0"/></linearGradient></defs>`;
  s += `<path d="${ridgePath(w, h, f)}" fill="url(#${id})"/>`;
  if (rim > 0) s += `<path d="${ridgeTop(w, f)}" fill="none" stroke="url(#${id}rim)" stroke-width="${Math.max(1.5, Math.min(w, h) * 0.004).toFixed(1)}" filter="url(#rimblur)"/>`;
  return s;
}

/**
 * A common landscape: sky, the one light and its glow, optional stars, ridges (far to near, each optionally with
 * firs), mist between them, and optional water from a line. A scene's `moon` (night) becomes the one light, pale and
 * without a crescent; `clouds` are left out.
 */
export function landscape(w, h, o) {
  const m = Math.min(w, h);
  const night = Boolean(o.moon);
  const sunX = w * LAMP_X;
  const sunY = night ? h * o.moon[1] : h * o.sun[1];
  const lightR = night ? o.moon[2] * 0.7 : o.sunR;
  let extra = sky('sky', o.sky) + glow('sunglow', sunX, sunY, Math.max(w, h) * (o.glowSize ?? 0.55), o.glowColor, o.glowStrength ?? 0.9);
  let body = `<rect width="${w}" height="${h}" fill="url(#sky)"/>`;
  if (o.stars) body += stars(w, h, o.stars.seed ?? 3, Math.round((w * h) / o.stars.density), o.stars.maxY);
  body += `<rect width="${w}" height="${h}" fill="url(#sunglow)"/>`;
  if (lightR) body += lamp(sunX, sunY, m, lightR, night ? '#f2eee4' : (o.sunColor ?? '#fff3d6'), o.glowColor);
  else body += lampRing(sunX, sunY, m, o.glowColor, 0.14);
  const fns = [];
  const count = o.ridges.length;
  for (const [i, layer] of o.ridges.entries()) {
    const f = ridgeFn(w, h, layer.base, layer.amp, layer.seed ?? 10 + i * 7, layer.detail ?? 1, layer.peaks ?? 0);
    fns.push(f);
    if (layer.mistBefore) body += mist(w, h * (layer.base - 0.03), h * 0.05, layer.mistBefore[0], layer.mistBefore[1]);
    // Far ridges face the light and catch it most; the nearest are dark shapes with only a trace along their tops.
    const rim = layer.rim ?? 0.55 * (1 - i / Math.max(1, count)) + 0.08;
    body += litRidge(w, h, f, i, layer, o.glowColor, sunX, rim);
    if (layer.firs) body += `<path d="${firsOn(w, f, layer.seed ?? 10 + i * 7, h * layer.firs.size, layer.firs.count)}" fill="${layer.firs.color ?? mixHex(layer.color, '#000000', 0.08)}"/>`;
    if (layer.waterAfter) {
      const wy = h * layer.waterAfter.y;
      body += water(w, h, wy, layer.waterAfter.stops, sunX, layer.waterAfter.glint, layer.seed);
      if (layer.waterAfter.reflect) body += reflection(w, h, f, wy, layer.waterAfter.reflect, 0.22);
    }
  }
  if (o.after) body += o.after(w, h, fns, sunX, sunY);
  return svg(w, h, extra, body);
}
