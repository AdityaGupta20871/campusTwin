/** Safe DOM builders: text is always assigned via textContent, never parsed as HTML. */

const SVG_NS = "http://www.w3.org/2000/svg";

function apply(node, { className, text, attrs, on, dataset } = {}) {
  if (className) node.setAttribute("class", className);
  if (text !== undefined && text !== null) node.textContent = String(text);
  if (attrs) for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null && v !== false) node.setAttribute(k, v === true ? "" : String(v));
  if (dataset) for (const [k, v] of Object.entries(dataset)) node.dataset[k] = String(v);
  if (on) for (const [evt, fn] of Object.entries(on)) node.addEventListener(evt, fn);
  return node;
}

export function h(tag, props = {}, children = []) {
  const node = apply(document.createElement(tag), props);
  for (const c of [].concat(children)) if (c !== null && c !== undefined && c !== false) node.append(c);
  return node;
}

export function s(tag, attrs = {}, children = []) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null) continue;
    if (k === "text") node.textContent = String(v);
    else node.setAttribute(k, String(v));
  }
  for (const c of [].concat(children)) if (c) node.append(c);
  return node;
}

export const $ = (id) => document.getElementById(id);

export const hexColor = (n) => `#${n.toString(16).padStart(6, "0")}`;

/** Mixes a 0xRRGGBB colour with white; amount 0..1 = share of white. */
export function tint(n, amount) {
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const mix = (c) => Math.round(c + (255 - c) * amount);
  return (mix(r) << 16) | (mix(g) << 8) | mix(b);
}

export function isTypingTarget(el) {
  return !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
}
