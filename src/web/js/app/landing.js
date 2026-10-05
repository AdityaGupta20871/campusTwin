import "./fonts.js";
import { createRuntime, listToolCatalog } from "../core/runtime.js";
import { formatDuration } from "../core/wayfinding.js";
import { renderIsoModel } from "../ui/iso-hero.js";
import { h, $ } from "../ui/dom.js";

// Legacy QR codes pointed at index.html?here=… — forward deep links to the studio.
const params = new URLSearchParams(location.search);
if (["here", "room", "floor", "view", "ask"].some((k) => params.has(k))) {
  location.replace(`studio.html${location.search}`);
}

const { model, executor } = createRuntime();
const catalog = listToolCatalog();
const roomCount = model.entries.length;

// ---------- Stats ----------
$("stats").replaceChildren(
  ...[
    ["Agent tools", String(catalog.length)],
    ["Shared state", "2D + 3D"],
    ["Floors", String(model.floors.length)],
    ["Mapped rooms", String(roomCount)],
  ].map(([k, v]) => h("div", {}, [h("dt", { text: k }), h("dd", { text: v })]))
);
$("footer-building").textContent = model.building.name.toUpperCase();

// ---------- Axonometric drawing ----------
const iso = $("iso");
const target = model.hasRoom("3-it") ? "3-it" : model.entries.at(-1).id;
renderIsoModel(iso, model, { to: target });

for (const btn of $("layers").querySelectorAll("button")) {
  btn.addEventListener("click", () => {
    const on = btn.getAttribute("aria-pressed") !== "true";
    btn.setAttribute("aria-pressed", String(on));
    iso.classList.toggle(`hide-${btn.dataset.layer}`, !on);
  });
}

// ---------- Live agent trace (real tool calls, headless) ----------
const ticker = $("ticker");
const destinationName = model.getRoom(target).room.name;
const script = [
  { who: "user", text: `Where is the ${destinationName}?` },
  { tool: "get_building_overview", args: {}, show: (d) => `${d.floors.length} floors · ${roomCount} rooms` },
  { tool: "search_rooms", args: { query: destinationName.toLowerCase(), limit: 3 }, show: (d) => `→ ${d.results[0]?.id ?? "no match"}` },
  { tool: "get_directions", args: { toRoomId: target }, show: (d) => `${formatDuration(d.etaSeconds)} · ${d.distanceM} m · via ${d.via}` },
  { tool: "validate_layout", args: {}, show: (d) => `${d.summary.errors} errors · ${d.summary.warnings} warnings` },
];

let runId = 0;
async function playTrace() {
  const id = ++runId;
  ticker.replaceChildren();
  let lastRoute = null;
  for (const step of script) {
    await new Promise((r) => setTimeout(r, 650));
    if (id !== runId) return;
    if (step.who) {
      ticker.append(h("li", {}, [h("span", { className: "who", text: "USER" }), h("span", { className: "reply", text: step.text })]));
      continue;
    }
    const res = await executor.execute(step.tool, step.args, { actor: "agent" });
    if (step.tool === "get_directions" && res.ok) lastRoute = res.data;
    ticker.append(
      h("li", {}, [
        h("span", { className: "who", text: "AGENT" }),
        h("span", {}, [h("span", { className: res.ok ? "ok" : "", text: `${step.tool}() ` }), res.ok ? step.show(res.data) : res.error.code]),
      ])
    );
  }
  if (lastRoute && id === runId) {
    await new Promise((r) => setTimeout(r, 650));
    ticker.append(h("li", {}, [h("span", { className: "who", text: "REPLY" }), h("span", { className: "reply", text: `${lastRoute.to.name} is on ${lastRoute.to.floor}. ${lastRoute.steps[1] ?? ""}` })]));
  }
}
$("replay").addEventListener("click", playTrace);
playTrace();

// ---------- Tool catalog ----------
$("tools-title").textContent = `${catalog.length} typed agent tools`;
const groups = [
  ["inspect", "Inspect"],
  ["navigate", "Navigate"],
  ["present", "Present"],
  ["validate", "Validate"],
];
$("tool-grid").replaceChildren(
  ...groups.map(([key, label]) => {
    const tools = catalog.filter((t) => t.category === key);
    return h("div", { className: "tool-col" }, [
      h("h3", {}, [h("span", { text: label }), h("span", { text: String(tools.length) })]),
      h(
        "ul",
        {},
        tools.map((t) =>
          h("li", {}, [
            h("code", { text: t.name }),
            h("span", { className: `tag ${t.readOnly ? "ro" : "rw"}`, text: t.readOnly ? "READ" : "ACTS" }),
            h("p", { text: t.description }),
          ])
        )
      ),
    ]);
  })
);

// ---------- Workflows ----------
$("workflow-grid").replaceChildren(
  ...model.workflows.map((wf) =>
    h("article", {}, [
      h("span", { className: "mono", text: `WORKFLOW · ${wf.id.toUpperCase()}` }),
      h("h3", { text: wf.name }),
      h("p", { text: wf.description }),
      h("ol", { className: "stops" }, wf.stops.filter(model.hasRoom).map((id) => h("li", { text: model.getRoom(id).room.name }))),
      h("a", { text: "Run in studio →", attrs: { href: `studio.html?workflow=${encodeURIComponent(wf.id)}` } }),
    ])
  )
);
