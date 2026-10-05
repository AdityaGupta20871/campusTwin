import { normalizeText } from "./search.js";
import { formatDuration } from "./wayfinding.js";

/**
 * Built-in "Concierge" agent.
 * Loop: perceive (normalise message) → plan (match a skill) → act (call typed tools via the
 * shared executor) → observe (tool results) → respond (grounded reply + visible tool trace).
 * It is deterministic and runs fully offline; external LLM agents use the same tools via WebMCP/MCP.
 */

export const MAX_MESSAGE_LENGTH = 500;

export const SAMPLE_PROMPTS = Object.freeze([
  "Where is the IT helpdesk?",
  "Nearest restroom",
  "I'm at Meeting Room 2.01",
  "Find a room for 12 people",
  "It's my first day",
  "Fire! Get me out",
  "What's on floor 3?",
  "Switch to walk mode",
  "Validate the layout",
]);

const TYPE_PATTERNS = [
  [/\b(rest ?rooms?|toilets?|washrooms?|bathrooms?|loo|lavatory|wc)\b/, "restroom"],
  [/\b(pantry|pantries|coffee|tea|water)\b/, "pantry"],
  [/\b(cafeteria|canteen|food|lunch|breakfast|dinner|eat|cafe)\b/, "cafeteria"],
  [/\b(lifts?|elevators?)\b/, "lift"],
  [/\b(stairs?|staircases?|stairways?|fire exits?)\b/, "stairs"],
  [/\b(first ?aid|first-aid|medical|doctor|nurse|clinic)\b/, "firstaid"],
  [/\b(meeting rooms?|conference rooms?|huddle|meeting)\b/, "meeting"],
  [/\b(wellness|prayer|quiet room|nursing room|meditation)\b/, "wellness"],
  [/\b(training|classroom)\b/, "training"],
  [/\b(reception|front desk)\b/, "reception"],
  [/\b(security)\b/, "security"],
  [/\b(lounge)\b/, "lounge"],
];

const LEAD =
  /^(?:(?:please|pls|kindly|can you|could you|would you|hey|hi|ok|okay)\s+)*(?:show me\s+|tell me\s+|help me\s+|i need to\s+|i want to\s+|i'd like to\s+)?(?:how (?:do|can|would|should) i (?:get|go|reach)(?: to)?|how to (?:get|go) to|how to reach|take me to|bring me to|guide me to|navigate(?: me)? to|directions? (?:to|for)|route to|way to|where(?:'s| is| are| do i find)|where can i find|i need(?: a| the)?|looking for|find(?: me)?|locate|go to|get to|reach|show)\s+/;
const FILLER = /\b(nearest|closest|nearby|near me|a|an|the|any|some|free|available|room|rooms|please|pls|one|me|here|to)\b/g;

const detectType = (t) => TYPE_PATTERNS.find(([re]) => re.test(t)) ?? null;

export function extractTarget(text) {
  return text
    .replace(LEAD, "")
    .replace(/[?!.]+$/, "")
    .replace(/^(?:the|a|an|my)\s+/, "")
    .trim();
}

function parseLevel(token) {
  if (!token) return null;
  return /^(g|ground)$/.test(token) ? 0 : Number(token);
}

export function createConciergeAgent({ model, executor, presentation = true, getHereId = () => null }) {
  async function call(trace, tool, args = {}) {
    const res = await executor.execute(tool, args, { actor: "agent" });
    const summary = res.ok ? executor.get(tool)?.summarize?.(res.data, args) ?? "Done" : res.error.message;
    trace.push({ tool, args, ok: res.ok, summary });
    return res;
  }

  const fail = (trace, intent, text, suggestions) => ({ intent, reply: { text, ...(suggestions && { suggestions }) }, trace });

  function routeReply(r, lead) {
    const via = r.via === "lift" ? " via lift" : r.via === "stairs" ? " via stairs" : "";
    return {
      text: `${lead ?? `${r.to.name} is on ${r.to.floor}.`} About ${formatDuration(r.etaSeconds)} (~${r.distanceM} m${via}).`,
      steps: r.steps,
      focus: r.to.id,
    };
  }

  async function navigate(trace, intent, toRoomId, { fromRoomId, lead } = {}) {
    const tool = presentation ? "navigate_to" : "get_directions";
    const res = await call(trace, tool, { toRoomId, ...(fromRoomId && { fromRoomId }) });
    if (!res.ok) return fail(trace, intent, res.error.message);
    return { intent, reply: routeReply(res.data, lead), trace };
  }

  /** Resolves free text to a room: specific name first, then "nearest of type". */
  async function resolveTarget(trace, phrase) {
    const typed = detectType(phrase);
    const residual = typed ? phrase.replace(typed[0], " ").replace(FILLER, " ").replace(/\s+/g, " ").trim() : phrase;
    if (typed && !residual) {
      const res = await call(trace, "find_nearest", { type: typed[1] });
      return res.ok ? { id: res.data.nearest.id, nearestOf: model.roomTypes[typed[1]].label } : { error: res.error.message };
    }
    const query = normalizeText(phrase).slice(0, 100);
    if (!query) return { error: "Tell me which room or facility you are looking for." };
    const res = await call(trace, "search_rooms", { query, limit: 5 });
    if (res.ok && res.data.count) return { id: res.data.results[0].id, alternatives: res.data.results.slice(1) };
    if (typed) {
      const near = await call(trace, "find_nearest", { type: typed[1] });
      if (near.ok) return { id: near.data.nearest.id, nearestOf: model.roomTypes[typed[1]].label };
    }
    return { error: `I couldn't find “${phrase}” in ${model.building.name}.` };
  }

  // Each skill: match(text) → params | null, run(params, trace) → response.
  const skills = [
    {
      intent: "help",
      match: (t) => (/^(hi|hello|hey|help|\?|what can you do|who are you|menu|start)[!?.\s]*$/.test(t) ? {} : null),
      run: async (_p, trace) => ({
        intent: "help",
        reply: {
          text: `I'm the ${model.building.name} concierge agent. I find rooms, give indoor directions, plan multi-stop journeys, show fire exits and check the layout — using the same typed tools available to WebMCP/MCP agents.`,
          suggestions: [...SAMPLE_PROMPTS],
        },
        trace,
      }),
    },
    {
      intent: "emergency",
      match: (t) => (/\b(fire|emergency|evacuat\w*|escape|smoke|alarm|exit route|get me out)\b/.test(t) ? {} : null),
      run: async (_p, trace) => {
        const res = await call(trace, presentation ? "show_emergency_exit" : "get_emergency_exit");
        if (!res.ok) return fail(trace, "emergency", res.error.message);
        return { intent: "emergency", reply: { ...routeReply(res.data, `Nearest exit: ${res.data.to.name}.`), tone: "danger" }, trace };
      },
    },
    {
      intent: "set_location",
      match: (t) => {
        const m = /\b(?:i am|i'm|im|i’m|currently)\s+(?:at|in|near|by|on)\s+(?:the\s+)?(.+?)[.!?]*$/.exec(t);
        return m ? { phrase: m[1] } : null;
      },
      run: async ({ phrase }, trace) => {
        const target = await resolveTarget(trace, phrase);
        if (target.error) return fail(trace, "set_location", target.error);
        const res = await call(trace, "set_my_location", { roomId: target.id });
        if (!res.ok) return fail(trace, "set_location", res.error.message);
        if (presentation) await call(trace, "focus_room", { roomId: target.id });
        const loc = res.data.location;
        return {
          intent: "set_location",
          reply: { text: `Got it — you are at ${loc.name} (${loc.floor}). Directions will now start from here.`, focus: loc.id, suggestions: ["Nearest restroom", "Fire! Get me out"] },
          trace,
        };
      },
    },
    {
      intent: "workflow",
      match: (t) => {
        if (/\b(new joiner|first day|onboarding|day one|day 1|joined today|induction)\b/.test(t)) return { workflowId: "new-joiner" };
        if (/\b(i'?m a visitor|i am a visitor|visitor (journey|tour|flow|workflow)|guest journey|visiting today)\b/.test(t)) return { workflowId: "visitor" };
        if (/\b(wellbeing|well-being|take a break|coffee break)\b/.test(t)) return { workflowId: "wellbeing-break" };
        if (/\b(workflows?|journeys?|itinerar(y|ies))\b/.test(t)) return { list: true };
        return null;
      },
      run: async ({ workflowId, list }, trace) => {
        if (list || !model.getWorkflow(workflowId)) {
          const res = await call(trace, "list_workflows");
          const names = res.ok ? res.data.workflows.map((w) => `${w.name}: ${w.stops.map((s) => s.name).join(" → ")}`) : [];
          return { intent: "workflow", reply: { text: "Here are the journeys I can guide you through:", steps: names, suggestions: ["It's my first day", "I'm a visitor"] }, trace };
        }
        const res = await call(trace, presentation ? "show_itinerary" : "plan_itinerary", { workflowId });
        if (!res.ok) return fail(trace, "workflow", res.error.message);
        const plan = res.data;
        return {
          intent: "workflow",
          reply: {
            text: `${plan.workflow?.name ?? "Itinerary"}: ${plan.stops.length} stops, about ${formatDuration(plan.etaSeconds)} of walking (~${plan.distanceM} m).`,
            steps: plan.segments.map((s, i) => `${i + 1}. ${s.to.name} (${s.to.floor}) — ${formatDuration(s.etaSeconds)}`),
          },
          trace,
        };
      },
    },
    {
      intent: "validate",
      match: (t) => (/\b(validate|validation|layout checks?|run (the )?checks|check (the )?layout|layout issues|audit|compliance)\b/.test(t) ? {} : null),
      run: async (_p, trace) => {
        const res = await call(trace, "validate_layout");
        if (!res.ok) return fail(trace, "validate", res.error.message);
        const { summary, issues } = res.data;
        return {
          intent: "validate",
          reply: {
            text: summary.errors || summary.warnings ? `Layout check: ${summary.errors} error(s), ${summary.warnings} warning(s).` : "Layout check passed — no issues found.",
            steps: issues.slice(0, 8).map((i) => `${i.severity.toUpperCase()} · ${i.message}`),
            tone: summary.errors ? "danger" : "ok",
          },
          trace,
        };
      },
    },
    {
      intent: "metrics",
      match: (t) => {
        if (!/\b(floor area|net area|gross area|metrics|square met\w*|sq ?m|m2|utili[sz]ation|how many (seats|desks|workstations)|seat count|occupancy|capacity of (the )?building)\b/.test(t)) return null;
        const m = /\b(?:floor|level)\s*(\d+|g|ground)\b/.exec(t) ?? (/\bground floor\b/.test(t) ? [null, "g"] : null);
        return { level: m ? parseLevel(m[1]) : undefined };
      },
      run: async ({ level }, trace) => {
        const res = await call(trace, "get_space_metrics", level === undefined ? {} : { level });
        if (!res.ok) return fail(trace, "metrics", res.error.message);
        const t = res.data.totals;
        return {
          intent: "metrics",
          reply: {
            text: `${t.floors} floor(s): ${t.netAreaM2} m² net of ${t.grossAreaM2} m² gross (${t.utilisationPct}% mapped), ${t.workstations} workstations, ${t.meetingSeats} meeting seats.`,
            steps: res.data.floors.map((f) => `${f.floor}: ${f.netAreaM2} m² net · ${f.rooms} rooms · ${f.workstations} desks`),
          },
          trace,
        };
      },
    },
    {
      intent: "overview",
      match: (t) => (/\b(overview|about (this|the) (building|office)|summary|how many floors|building info)\b/.test(t) ? {} : null),
      run: async (_p, trace) => {
        const res = await call(trace, "get_building_overview");
        if (!res.ok) return fail(trace, "overview", res.error.message);
        const d = res.data;
        return {
          intent: "overview",
          reply: { text: `${d.name}: ${d.floors.length} floors, ${d.floors.reduce((s, f) => s + f.rooms, 0)} mapped rooms.`, steps: d.floors.map((f) => `${f.name} — ${f.rooms} rooms`) },
          trace,
        };
      },
    },
    {
      intent: "switch_view",
      match: (t) => {
        const explicit = /^(walk( mode)?|3d|orbit|plan( view)?|2d|floor plan)$/.test(t) || /\b(switch|change|go|open|enter|use|show)\b.*\b(walk|3d|orbit|plan|2d)\b/.test(t);
        if (!explicit) return null;
        if (/\bwalk/.test(t)) return { view: "walk" };
        if (/\b(3d|orbit)\b/.test(t)) return { view: "orbit" };
        return { view: "plan" };
      },
      run: async ({ view }, trace) => {
        if (!presentation) return fail(trace, "switch_view", "Views are only available in the studio UI.");
        const res = await call(trace, "switch_view", { view });
        if (!res.ok) return fail(trace, "switch_view", res.error.message);
        const label = { plan: "2D floor plan", orbit: "3D orbit", walk: "walk mode (drag to look, WASD to move)" }[view];
        return { intent: "switch_view", reply: { text: `Switched to ${label}.` }, trace };
      },
    },
    {
      intent: "meeting_room",
      match: (t) => {
        const m = /\b(\d{1,4})\s*(?:people|persons|person|pax|attendees|participants|seats|of us)\b/.exec(t);
        return m && /\b(room|meeting|space|seat|fit|book|host)\b/.test(t) ? { people: Number(m[1]) } : null;
      },
      run: async ({ people }, trace) => {
        const res = await call(trace, "find_meeting_room", { people });
        if (!res.ok) return fail(trace, "meeting_room", res.error.message);
        const best = res.data.best;
        return navigate(trace, "meeting_room", best.id, { lead: `${best.name} (${best.floor}) seats ${best.capacity} — best fit for ${people}.` });
      },
    },
    {
      intent: "floor",
      match: (t) => {
        const m = /\b(?:floor|level)\s*(\d+|g|ground)\b/.exec(t) ?? (/\bground floor\b/.test(t) ? [null, "g"] : null);
        if (!m) return null;
        const rest = t
          .replace(/\b(?:floor|level)\s*(\d+|g|ground)\b|\bground floor\b/, " ")
          .replace(/\b(what'?s|what is|what|is|are|on|in|show|me|the|go|to|open|list|all|rooms?|there|take|display|see)\b|[?!.]/g, " ")
          .trim();
        return rest ? null : { level: parseLevel(m[1]) };
      },
      run: async ({ level }, trace) => {
        if (!model.getFloor(level)) return fail(trace, "floor", `There is no floor at level ${level}.`);
        if (presentation) await call(trace, "set_active_floor", { level });
        const res = await call(trace, "list_rooms", { level });
        if (!res.ok) return fail(trace, "floor", res.error.message);
        return {
          intent: "floor",
          reply: { text: `${model.getFloor(level).name} has ${res.data.count} mapped spaces:`, steps: res.data.rooms.map((r) => r.name) },
          trace,
        };
      },
    },
    {
      intent: "clear",
      match: (t) => (/^(clear|reset|cancel|stop|clear (the )?(map|route))$/.test(t) ? {} : null),
      run: async (_p, trace) => {
        if (!presentation) return fail(trace, "clear", "Nothing to clear.");
        await call(trace, "clear_map");
        return { intent: "clear", reply: { text: "Map cleared." }, trace };
      },
    },
  ];

  async function respond(message) {
    const trace = [];
    const raw = String(message ?? "").trim();
    if (!raw) return skills[0].run({}, trace);
    if (raw.length > MAX_MESSAGE_LENGTH) return fail(trace, "rejected", `Please keep messages under ${MAX_MESSAGE_LENGTH} characters.`);

    const t = raw.toLowerCase().replace(/[’`]/g, "'").replace(/\s+/g, " ");
    for (const skill of skills) {
      const params = skill.match(t);
      if (params) return skill.run(params, trace);
    }

    // Default skill: navigation ("from X to Y", "where is X", "nearest X", or just "X").
    const between = /\bfrom\s+(?:the\s+)?(.+?)\s+to\s+(?:the\s+)?(.+?)[?!.]*$/.exec(t);
    let fromRoomId;
    let phrase = extractTarget(t);
    if (between) {
      const from = await resolveTarget(trace, between[1]);
      if (from.error) return fail(trace, "navigate", from.error, [...SAMPLE_PROMPTS.slice(0, 3)]);
      fromRoomId = from.id;
      phrase = extractTarget(between[2]);
    }
    const target = await resolveTarget(trace, phrase);
    if (target.error) return fail(trace, "navigate", `${target.error} Try a room name, a facility (restroom, pantry, lift) or a person-count.`, [...SAMPLE_PROMPTS.slice(0, 4)]);

    const here = getHereId();
    if (!fromRoomId && here === target.id) {
      if (presentation) await call(trace, "focus_room", { roomId: target.id });
      return { intent: "navigate", reply: { text: `You're already at ${model.getRoom(target.id).room.name}.`, focus: target.id }, trace };
    }
    const lead = target.nearestOf ? `Nearest ${target.nearestOf.toLowerCase()}: ${model.getRoom(target.id).room.name} (${model.getRoom(target.id).floor.name}).` : undefined;
    return navigate(trace, "navigate", target.id, { fromRoomId, lead });
  }

  return { respond };
}
