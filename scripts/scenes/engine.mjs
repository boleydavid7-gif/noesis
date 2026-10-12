// A small flat-illustration scene kit: layered ridges, firs on the ridge line, sky, sun or moon, clouds,
// mist, still water with reflections, and a few foreground things. Everything is seeded so it redraws the same.

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

export const defs = `<filter id="grain"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch"/><feColorMatrix values="0 0 0 0 0.5 0 0 0 0 0.5 0 0 0 0 0.5 0 0 0 0.07 0"/></filter><filter id="blur" x="-0.2" y="-2" width="1.4" height="5"><feGaussianBlur stdDeviation="18"/></filter><filter id="soft" x="-1" y="-1" width="3" height="3"><feGaussianBlur stdDeviation="3"/></filter><filter id="glowblur" x="-1" y="-1" width="3" height="3"><feGaussianBlur stdDeviation="8"/></filter>`;

export function sky(id, stops) {
  return `<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">${stops.map(([o, c]) => `<stop offset="${o}" stop-color="${c}"/>`).join('')}</linearGradient>`;
}

export function glow(id, cx, cy, r, color, strength = 0.9) {
  return `<radialGradient id="${id}" cx="${cx}" cy="${cy}" r="${r}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${color}" stop-opacity="${strength}"/><stop offset="0.14" stop-color="${color}" stop-opacity="${strength * 0.55}"/><stop offset="0.5" stop-color="${color}" stop-opacity="${strength * 0.12}"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></radialGradient>`;
}

export function mist(w, y, height, color, opacity) {
  return `<rect x="0" y="${y}" width="${w}" height="${height}" fill="${color}" opacity="${opacity}" filter="url(#blur)"/>`;
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
  return `<path d="M0,${y} L${pts.join(' L')} L${w},${y} Z" fill="${color}" opacity="${opacity}"/>`;
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
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><defs>${defs}${extraDefs}</defs>${body}<rect width="${w}" height="${h}" filter="url(#grain)"/></svg>`;
}

/**
 * A common landscape: sky, glow and sun, optional moon and stars, clouds, ridges (far to near, each optionally
 * with firs), mist between them, and optional water from a line.
 */
export function landscape(w, h, o) {
  const m = Math.min(w, h);
  const sunX = w * o.sun[0];
  const sunY = h * o.sun[1];
  let extra = sky('sky', o.sky) + glow('sunglow', sunX, sunY, Math.max(w, h) * (o.glowSize ?? 0.55), o.glowColor, o.glowStrength ?? 0.9);
  let body = `<rect width="${w}" height="${h}" fill="url(#sky)"/>`;
  if (o.stars) body += stars(w, h, o.stars.seed ?? 3, Math.round((w * h) / o.stars.density), o.stars.maxY);
  body += `<rect width="${w}" height="${h}" fill="url(#sunglow)"/>`;
  if (o.moon) {
    const [mx, my, mr] = [w * o.moon[0], h * o.moon[1], m * o.moon[2]];
    body += `<circle cx="${mx}" cy="${my}" r="${mr}" fill="#efe6d2"/><circle cx="${mx + mr * 0.45}" cy="${my - mr * 0.25}" r="${mr * 0.92}" fill="${o.moonSky}"/>`;
  }
  if (o.clouds) for (const c of o.clouds) body += clouds(w, h, c.seed, c.n, c.y0, c.y1, c.color, c.opacity, c.size ?? 1);
  if (o.sunR) body += `<circle cx="${sunX}" cy="${sunY}" r="${m * o.sunR}" fill="${o.sunColor ?? '#fff3d6'}"/>`;
  const fns = [];
  for (const [i, layer] of o.ridges.entries()) {
    const f = ridgeFn(w, h, layer.base, layer.amp, layer.seed ?? 10 + i * 7, layer.detail ?? 1, layer.peaks ?? 0);
    fns.push(f);
    if (layer.mistBefore) body += mist(w, h * (layer.base - 0.03), h * 0.06, layer.mistBefore[0], layer.mistBefore[1]);
    body += `<path d="${ridgePath(w, h, f)}" fill="${layer.color}"/>`;
    if (layer.firs) body += `<path d="${firsOn(w, f, layer.seed ?? 10 + i * 7, h * layer.firs.size, layer.firs.count)}" fill="${layer.firs.color ?? layer.color}"/>`;
    if (layer.waterAfter) {
      const wy = h * layer.waterAfter.y;
      body += water(w, h, wy, layer.waterAfter.stops, sunX, layer.waterAfter.glint, layer.seed);
      if (layer.waterAfter.reflect) body += reflection(w, h, f, wy, layer.waterAfter.reflect, 0.18);
    }
  }
  if (o.after) body += o.after(w, h, fns);
  return svg(w, h, extra, body);
}
