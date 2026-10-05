import { normalizeText } from "./search.js";
import { formatDuration, type Route } from "./wayfinding.js";
import { type BuildingModel } from "./model.js";
import { type ToolExecutionResult, type ToolExecutor, type ViewMode } from "./tools.js";

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

const TYPE_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
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

type AgentIntent = "help" | "emergency" | "set_location" | "workflow" | "validate" | "metrics" | "overview" | "switch_view" | "meeting_room" | "floor" | "clear" | "navigate" | "rejected";

export interface AgentReply {
  text: string;
  steps?: string[];
  focus?: string;
  suggestions?: string[];
  tone?: "danger" | "ok";
}

export interface AgentTraceEntry {
  tool: string;
  args: Record<string, unknown>;
  ok: boolean;
  summary: string;
}

export interface AgentResponse {
  intent: AgentIntent;
  reply: AgentReply;
  trace: AgentTraceEntry[];
}

export interface ConciergeOptions {
  model: Readonly<BuildingModel>;
  executor: ToolExecutor;
  presentation?: boolean;
  getHereId?: () => string | null;
}

interface Skill {
  intent: AgentIntent;
  match(text: string): Record<string, unknown> | null;
  run(params: Record<string, unknown>, trace: AgentTraceEntry[]): Promise<AgentResponse>;
}

type RoomSummary = { id: string; name: string; type: string; level: number; floor: string };
type PublicRoute = Omit<Route, "legs" | "verticals"> & { emergency?: boolean };
type TargetResolution =
  | { id: string; nearestOf?: string; alternatives?: Array<RoomSummary & { score: number }> }
  | { error: string };

const detectType = (text: string): readonly [RegExp, string] | null => TYPE_PATTERNS.find(([pattern]) => pattern.test(text)) ?? null;

export function extractTarget(text: string): string {
  return text
    .replace(LEAD, "")
    .replace(/[?!.]+$/, "")
    .replace(/^(?:the|a|an|my)\s+/, "")
    .trim();
}

function parseLevel(token: string | undefined): number | null {
  if (!token) return null;
  return /^(g|ground)$/.test(token) ? 0 : Number(token);
}

function stringParam(params: Record<string, unknown>, key: string): string | undefined {
  const value = params[key];
  return typeof value === "string" ? value : undefined;
}

function numberParam(params: Record<string, unknown>, key: string): number | undefined {
  const value = params[key];
  return typeof value === "number" ? value : undefined;
}

export function createConciergeAgent({ model, executor, presentation = true, getHereId = () => null }: ConciergeOptions) {
  async function call(trace: AgentTraceEntry[], tool: string, args: Record<string, unknown> = {}): Promise<ToolExecutionResult> {
    const result = await executor.execute(tool, args, { actor: "agent" });
    const summary = result.ok ? executor.get(tool)?.summarize?.(result.data, args) ?? "Done" : result.error.message;
    trace.push({ tool, args, ok: result.ok, summary });
    return result;
  }

  const fail = (trace: AgentTraceEntry[], intent: AgentIntent, text: string, suggestions?: string[]): AgentResponse => ({
    intent,
    reply: { text, ...(suggestions && { suggestions }) },
    trace,
  });

  function routeReply(route: PublicRoute, lead?: string): AgentReply {
    const via = route.via === "lift" ? " via lift" : route.via === "stairs" ? " via stairs" : "";
    return {
      text: `${lead ?? `${route.to.name} is on ${route.to.floor}.`} About ${formatDuration(route.etaSeconds)} (~${route.distanceM} m${via}).`,
      steps: route.steps,
      focus: route.to.id,
    };
  }

  async function navigate(
    trace: AgentTraceEntry[],
    intent: AgentIntent,
    toRoomId: string,
    options: { fromRoomId?: string; lead?: string } = {},
  ): Promise<AgentResponse> {
    const tool = presentation ? "navigate_to" : "get_directions";
    const result = await call(trace, tool, { toRoomId, ...(options.fromRoomId && { fromRoomId: options.fromRoomId }) });
    if (!result.ok) return fail(trace, intent, result.error.message);
    return { intent, reply: routeReply(result.data as PublicRoute, options.lead), trace };
  }

  async function resolveTarget(trace: AgentTraceEntry[], phrase: string): Promise<TargetResolution> {
    const typed = detectType(phrase);
    const residual = typed ? phrase.replace(typed[0], " ").replace(FILLER, " ").replace(/\s+/g, " ").trim() : phrase;
    if (typed && !residual) {
      const result = await call(trace, "find_nearest", { type: typed[1] });
      if (!result.ok) return { error: result.error.message };
      const data = result.data as { nearest: RoomSummary };
      return { id: data.nearest.id, nearestOf: model.roomTypes[typed[1]].label };
    }

    const query = normalizeText(phrase).slice(0, 100);
    if (!query) return { error: "Tell me which room or facility you are looking for." };
    const result = await call(trace, "search_rooms", { query, limit: 5 });
    if (result.ok) {
      const data = result.data as { count: number; results: Array<RoomSummary & { score: number }> };
      if (data.count) return { id: data.results[0].id, alternatives: data.results.slice(1) };
    }
    if (typed) {
      const nearest = await call(trace, "find_nearest", { type: typed[1] });
      if (nearest.ok) {
        const data = nearest.data as { nearest: RoomSummary };
        return { id: data.nearest.id, nearestOf: model.roomTypes[typed[1]].label };
      }
    }
    return { error: `I couldn't find “${phrase}” in ${model.building.name}.` };
  }

  const skills: Skill[] = [
    {
      intent: "help",
      match: (text) => (/^(hi|hello|hey|help|\?|what can you do|who are you|menu|start)[!?.\s]*$/.test(text) ? {} : null),
      run: async (_params, trace) => ({
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
      match: (text) => (/\b(fire|emergency|evacuat\w*|escape|smoke|alarm|exit route|get me out)\b/.test(text) ? {} : null),
      run: async (_params, trace) => {
        const result = await call(trace, presentation ? "show_emergency_exit" : "get_emergency_exit");
        if (!result.ok) return fail(trace, "emergency", result.error.message);
        const route = result.data as PublicRoute;
        return { intent: "emergency", reply: { ...routeReply(route, `Nearest exit: ${route.to.name}.`), tone: "danger" }, trace };
      },
    },
    {
      intent: "set_location",
      match: (text) => {
        const match = /\b(?:i am|i'm|im|i’m|currently)\s+(?:at|in|near|by|on)\s+(?:the\s+)?(.+?)[.!?]*$/.exec(text);
        return match ? { phrase: match[1] } : null;
      },
      run: async (params, trace) => {
        const target = await resolveTarget(trace, stringParam(params, "phrase") ?? "");
        if ("error" in target) return fail(trace, "set_location", target.error);
        const result = await call(trace, "set_my_location", { roomId: target.id });
        if (!result.ok) return fail(trace, "set_location", result.error.message);
        if (presentation) await call(trace, "focus_room", { roomId: target.id });
        const location = (result.data as { location: RoomSummary }).location;
        return {
          intent: "set_location",
          reply: { text: `Got it — you are at ${location.name} (${location.floor}). Directions will now start from here.`, focus: location.id, suggestions: ["Nearest restroom", "Fire! Get me out"] },
          trace,
        };
      },
    },
    {
      intent: "workflow",
      match: (text) => {
        if (/\b(new joiner|first day|onboarding|day one|day 1|joined today|induction)\b/.test(text)) return { workflowId: "new-joiner" };
        if (/\b(i'?m a visitor|i am a visitor|visitor (journey|tour|flow|workflow)|guest journey|visiting today)\b/.test(text)) return { workflowId: "visitor" };
        if (/\b(wellbeing|well-being|take a break|coffee break)\b/.test(text)) return { workflowId: "wellbeing-break" };
        if (/\b(workflows?|journeys?|itinerar(y|ies))\b/.test(text)) return { list: true };
        return null;
      },
      run: async (params, trace) => {
        const workflowId = stringParam(params, "workflowId");
        if (params.list === true || !model.getWorkflow(workflowId ?? "")) {
          const result = await call(trace, "list_workflows");
          const data = result.ok ? result.data as { workflows: Array<{ name: string; stops: RoomSummary[] }> } : null;
          const names = data?.workflows.map((workflow) => `${workflow.name}: ${workflow.stops.map((stop) => stop.name).join(" → ")}`) ?? [];
          return { intent: "workflow", reply: { text: "Here are the journeys I can guide you through:", steps: names, suggestions: ["It's my first day", "I'm a visitor"] }, trace };
        }
        const result = await call(trace, presentation ? "show_itinerary" : "plan_itinerary", { workflowId });
        if (!result.ok) return fail(trace, "workflow", result.error.message);
        const plan = result.data as {
          workflow?: { name: string } | null;
          stops: RoomSummary[];
          etaSeconds: number;
          distanceM: number;
          segments: Array<{ to: RoomSummary; etaSeconds: number }>;
        };
        return {
          intent: "workflow",
          reply: {
            text: `${plan.workflow?.name ?? "Itinerary"}: ${plan.stops.length} stops, about ${formatDuration(plan.etaSeconds)} of walking (~${plan.distanceM} m).`,
            steps: plan.segments.map((segment, index) => `${index + 1}. ${segment.to.name} (${segment.to.floor}) — ${formatDuration(segment.etaSeconds)}`),
          },
          trace,
        };
      },
    },
    {
      intent: "validate",
      match: (text) => (/\b(validate|validation|layout checks?|run (the )?checks|check (the )?layout|layout issues|audit|compliance)\b/.test(text) ? {} : null),
      run: async (_params, trace) => {
        const result = await call(trace, "validate_layout");
        if (!result.ok) return fail(trace, "validate", result.error.message);
        const data = result.data as { summary: { errors: number; warnings: number }; issues: Array<{ severity: string; message: string }> };
        return {
          intent: "validate",
          reply: {
            text: data.summary.errors || data.summary.warnings ? `Layout check: ${data.summary.errors} error(s), ${data.summary.warnings} warning(s).` : "Layout check passed — no issues found.",
            steps: data.issues.slice(0, 8).map((issue) => `${issue.severity.toUpperCase()} · ${issue.message}`),
            tone: data.summary.errors ? "danger" : "ok",
          },
          trace,
        };
      },
    },
    {
      intent: "metrics",
      match: (text) => {
        if (!/\b(floor area|net area|gross area|metrics|square met\w*|sq ?m|m2|utili[sz]ation|how many (seats|desks|workstations)|seat count|occupancy|capacity of (the )?building)\b/.test(text)) return null;
        const match = /\b(?:floor|level)\s*(\d+|g|ground)\b/.exec(text) ?? (/\bground floor\b/.test(text) ? [null, "g"] : null);
        return { level: match ? parseLevel(match[1]) : undefined };
      },
      run: async (params, trace) => {
        const level = numberParam(params, "level");
        const result = await call(trace, "get_space_metrics", level === undefined ? {} : { level });
        if (!result.ok) return fail(trace, "metrics", result.error.message);
        const data = result.data as { totals: { floors: number; netAreaM2: number; grossAreaM2: number; utilisationPct: number; workstations: number; meetingSeats: number }; floors: Array<{ floor: string; netAreaM2: number; rooms: number; workstations: number }> };
        const totals = data.totals;
        return {
          intent: "metrics",
          reply: {
            text: `${totals.floors} floor(s): ${totals.netAreaM2} m² net of ${totals.grossAreaM2} m² gross (${totals.utilisationPct}% mapped), ${totals.workstations} workstations, ${totals.meetingSeats} meeting seats.`,
            steps: data.floors.map((floor) => `${floor.floor}: ${floor.netAreaM2} m² net · ${floor.rooms} rooms · ${floor.workstations} desks`),
          },
          trace,
        };
      },
    },
    {
      intent: "overview",
      match: (text) => (/\b(overview|about (this|the) (building|office)|summary|how many floors|building info)\b/.test(text) ? {} : null),
      run: async (_params, trace) => {
        const result = await call(trace, "get_building_overview");
        if (!result.ok) return fail(trace, "overview", result.error.message);
        const data = result.data as { name: string; floors: Array<{ name: string; rooms: number }> };
        return {
          intent: "overview",
          reply: { text: `${data.name}: ${data.floors.length} floors, ${data.floors.reduce((total, floor) => total + floor.rooms, 0)} mapped rooms.`, steps: data.floors.map((floor) => `${floor.name} — ${floor.rooms} rooms`) },
          trace,
        };
      },
    },
    {
      intent: "switch_view",
      match: (text) => {
        const explicit = /^(walk( mode)?|3d|orbit|plan( view)?|2d|floor plan)$/.test(text) || /\b(switch|change|go|open|enter|use|show)\b.*\b(walk|3d|orbit|plan|2d)\b/.test(text);
        if (!explicit) return null;
        if (/\bwalk/.test(text)) return { view: "walk" satisfies ViewMode };
        if (/\b(3d|orbit)\b/.test(text)) return { view: "orbit" satisfies ViewMode };
        return { view: "plan" satisfies ViewMode };
      },
      run: async (params, trace) => {
        if (!presentation) return fail(trace, "switch_view", "Views are only available in the studio UI.");
        const view = stringParam(params, "view") as ViewMode;
        const result = await call(trace, "switch_view", { view });
        if (!result.ok) return fail(trace, "switch_view", result.error.message);
        const labels: Record<ViewMode, string> = { plan: "2D floor plan", orbit: "3D orbit", walk: "walk mode (drag to look, WASD to move)" };
        return { intent: "switch_view", reply: { text: `Switched to ${labels[view]}.` }, trace };
      },
    },
    {
      intent: "meeting_room",
      match: (text) => {
        const match = /\b(\d{1,4})\s*(?:people|persons|person|pax|attendees|participants|seats|of us)\b/.exec(text);
        return match && /\b(room|meeting|space|seat|fit|book|host)\b/.test(text) ? { people: Number(match[1]) } : null;
      },
      run: async (params, trace) => {
        const people = numberParam(params, "people") ?? 0;
        const result = await call(trace, "find_meeting_room", { people });
        if (!result.ok) return fail(trace, "meeting_room", result.error.message);
        const best = (result.data as { best: RoomSummary & { capacity: number } }).best;
        return navigate(trace, "meeting_room", best.id, { lead: `${best.name} (${best.floor}) seats ${best.capacity} — best fit for ${people}.` });
      },
    },
    {
      intent: "floor",
      match: (text) => {
        const match = /\b(?:floor|level)\s*(\d+|g|ground)\b/.exec(text) ?? (/\bground floor\b/.test(text) ? [null, "g"] : null);
        if (!match) return null;
        const rest = text
          .replace(/\b(?:floor|level)\s*(\d+|g|ground)\b|\bground floor\b/, " ")
          .replace(/\b(what'?s|what is|what|is|are|on|in|show|me|the|go|to|open|list|all|rooms?|there|take|display|see)\b|[?!.]/g, " ")
          .trim();
        return rest ? null : { level: parseLevel(match[1]) };
      },
      run: async (params, trace) => {
        const level = numberParam(params, "level") ?? 0;
        const floor = model.getFloor(level);
        if (!floor) return fail(trace, "floor", `There is no floor at level ${level}.`);
        if (presentation) await call(trace, "set_active_floor", { level });
        const result = await call(trace, "list_rooms", { level });
        if (!result.ok) return fail(trace, "floor", result.error.message);
        const data = result.data as { count: number; rooms: RoomSummary[] };
        return { intent: "floor", reply: { text: `${floor.name} has ${data.count} mapped spaces:`, steps: data.rooms.map((room) => room.name) }, trace };
      },
    },
    {
      intent: "clear",
      match: (text) => (/^(clear|reset|cancel|stop|clear (the )?(map|route))$/.test(text) ? {} : null),
      run: async (_params, trace) => {
        if (!presentation) return fail(trace, "clear", "Nothing to clear.");
        await call(trace, "clear_map");
        return { intent: "clear", reply: { text: "Map cleared." }, trace };
      },
    },
  ];

  async function respond(message: unknown): Promise<AgentResponse> {
    const trace: AgentTraceEntry[] = [];
    const raw = String(message ?? "").trim();
    if (!raw) return skills[0].run({}, trace);
    if (raw.length > MAX_MESSAGE_LENGTH) return fail(trace, "rejected", `Please keep messages under ${MAX_MESSAGE_LENGTH} characters.`);

    const normalized = raw.toLowerCase().replace(/[’`]/g, "'").replace(/\s+/g, " ");
    for (const skill of skills) {
      const params = skill.match(normalized);
      if (params) return skill.run(params, trace);
    }

    const between = /\bfrom\s+(?:the\s+)?(.+?)\s+to\s+(?:the\s+)?(.+?)[?!.]*$/.exec(normalized);
    let fromRoomId: string | undefined;
    let phrase = extractTarget(normalized);
    if (between) {
      const from = await resolveTarget(trace, between[1]);
      if ("error" in from) return fail(trace, "navigate", from.error, [...SAMPLE_PROMPTS.slice(0, 3)]);
      fromRoomId = from.id;
      phrase = extractTarget(between[2]);
    }
    const target = await resolveTarget(trace, phrase);
    if ("error" in target) {
      return fail(trace, "navigate", `${target.error} Try a room name, a facility (restroom, pantry, lift) or a person-count.`, [...SAMPLE_PROMPTS.slice(0, 4)]);
    }

    const here = getHereId();
    if (!fromRoomId && here === target.id) {
      if (presentation) await call(trace, "focus_room", { roomId: target.id });
      return { intent: "navigate", reply: { text: `You're already at ${model.getRoom(target.id)!.room.name}.`, focus: target.id }, trace };
    }
    const entry = model.getRoom(target.id)!;
    const lead = target.nearestOf ? `Nearest ${target.nearestOf.toLowerCase()}: ${entry.room.name} (${entry.floor.name}).` : undefined;
    return navigate(trace, "navigate", target.id, { fromRoomId, lead });
  }

  return { respond };
}