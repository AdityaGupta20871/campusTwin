import { building as defaultBuilding, roomTypes as defaultRoomTypes } from "../../../web/js/data/building-data.js";
import { createModel, type BuildingData, type RoomTypeMap } from "./model.js";
import {
  createCoreTools,
  createPresentationTools,
  createToolContext,
  createToolExecutor,
  type Presenter,
  type ToolEvent,
  type ToolExecutor,
  type ToolSession,
  type JsonSchema,
  type ToolCategory,
} from "./tools.js";

export function createMemorySession(initialHereId: string | null = null): ToolSession {
  let hereId = initialHereId;
  return {
    getHereId: () => hereId,
    setHereId: (id) => {
      hereId = id;
    },
  };
}

export interface RuntimeOptions {
  building?: BuildingData;
  roomTypes?: RoomTypeMap;
  session?: ToolSession;
  presenter?: Presenter | null;
  onEvent?: (event: ToolEvent) => void;
}

export interface Runtime {
  model: ReturnType<typeof createModel>;
  session: ToolSession;
  executor: ToolExecutor;
}

export function createRuntime({
  building = defaultBuilding,
  roomTypes = defaultRoomTypes,
  session = createMemorySession(),
  presenter = null,
  onEvent,
}: RuntimeOptions = {}): Runtime {
  const model = createModel(building, roomTypes);
  const context = createToolContext(model, session);
  const tools = [...createCoreTools(context), ...(presenter ? createPresentationTools(context, presenter) : [])];
  const executor = createToolExecutor(tools, { onEvent });
  return { model, session, executor };
}

const NOOP_PRESENTER: Presenter = Object.freeze({
  getState: () => ({}),
  setView: () => {},
  setActiveFloor: () => {},
  focusRoom: () => {},
  showRoute: () => {},
  clear: () => {},
});

export interface ToolCatalogItem {
  name: string;
  title: string;
  description: string;
  category: ToolCategory;
  readOnly: boolean;
  inputSchema: JsonSchema;
}

export function listToolCatalog(): ToolCatalogItem[] {
  return createRuntime({ presenter: NOOP_PRESENTER })
    .executor.list()
    .map(({ name, title, description, category, readOnly, inputSchema }) => ({ name, title, description, category, readOnly, inputSchema }));
}