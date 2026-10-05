// SAMPLE LAYOUT — replace names, positions and details with the real Noida floor plans.
// Units are metres from the building centre: x = west(-)/east(+), z = north(-)/south(+).
// Room: { id, name, type, x, z, w, d, height?, capacity?, hours?, contact?, info?, tags?, directions? }

export const roomTypes = Object.freeze({
  reception: { label: "Reception", color: 0x2e7dd7, icon: "🛎️" },
  security: { label: "Security", color: 0x475569, icon: "🛡️" },
  lounge: { label: "Lounge", color: 0x7c9cbf, icon: "🛋️" },
  cafeteria: { label: "Cafeteria", color: 0xf59e0b, icon: "🍽️" },
  pantry: { label: "Pantry", color: 0xfbbf24, icon: "☕" },
  workspace: { label: "Workspace", color: 0x94a3b8, icon: "💻" },
  meeting: { label: "Meeting Room", color: 0x8b5cf6, icon: "👥" },
  training: { label: "Training", color: 0x14b8a6, icon: "🎓" },
  restroom: { label: "Restrooms", color: 0x0ea5e9, icon: "🚻" },
  lift: { label: "Lifts", color: 0x334155, icon: "🛗" },
  stairs: { label: "Stairs / Fire Exit", color: 0x16a34a, icon: "🚪" },
  firstaid: { label: "First Aid", color: 0xdc2626, icon: "⛑️" },
  office: { label: "Office", color: 0x64748b, icon: "🏢" },
  wellness: { label: "Wellness", color: 0x22c55e, icon: "🧘" },
  other: { label: "Area", color: 0xa1a1aa, icon: "📍" },
});

const core = (p) => [
  { id: `${p}-lift`, name: "Lift Lobby", type: "lift", x: 0, z: 0, w: 6, d: 4, info: "Central lifts serving all floors." },
  { id: `${p}-stairs-a`, name: "Staircase A (Fire Exit)", type: "stairs", x: -27, z: -12, w: 5, d: 5, info: "Emergency exit route. Do not use lifts during a fire alarm." },
  { id: `${p}-stairs-b`, name: "Staircase B (Fire Exit)", type: "stairs", x: 27, z: 12, w: 5, d: 5, info: "Emergency exit route. Do not use lifts during a fire alarm." },
  { id: `${p}-restrooms`, name: "Restrooms", type: "restroom", x: 25, z: 4, w: 8, d: 6 },
];

const deliveryFloor = (level) => [
  { id: `${level}-bay-a`, name: `ODC Bay ${level}A`, type: "workspace", x: -16, z: 8, w: 20, d: 10, capacity: "80 seats" },
  { id: `${level}-bay-b`, name: `ODC Bay ${level}B`, type: "workspace", x: 12, z: 8, w: 16, d: 10, capacity: "64 seats" },
  { id: `${level}-bay-c`, name: `ODC Bay ${level}C`, type: "workspace", x: 12, z: -8, w: 16, d: 10, capacity: "64 seats" },
  { id: `${level}-meet-1`, name: `Meeting Room ${level}.01`, type: "meeting", x: -18, z: -5, w: 8, d: 6, capacity: "8 people", info: "Screen + Teams Room kit." },
  { id: `${level}-meet-2`, name: `Meeting Room ${level}.02`, type: "meeting", x: -9, z: -5, w: 8, d: 6, capacity: "6 people" },
  { id: `${level}-pantry`, name: "Pantry", type: "pantry", x: -13, z: -12, w: 14, d: 5, info: "Tea, coffee and water." },
  { id: `${level}-huddle`, name: "Huddle Space", type: "meeting", x: 25, z: -6, w: 8, d: 6, capacity: "4 people" },
  ...core(level),
];

export const building = {
  id: "sopra-steria-noida",
  name: "Sopra Steria – Noida",
  subtitle: "Human + Agent workplace twin (sample layout)",
  dimensionBasis: "estimated",
  dimensionSource: "Synthetic starter geometry; verify against site drawings before relying on it.",
  footprint: { width: 60, depth: 30 },
  floorSpacing: 7,
  // Main east–west corridor used for indicative routing.
  circulation: { spineZ: 0 },
  defaultOriginId: "g-reception",
  floors: [
    {
      level: 0,
      short: "G",
      name: "Ground Floor",
      rooms: [
        { id: "g-reception", name: "Reception", type: "reception", x: 0, z: 10, w: 14, d: 8, hours: "08:00 – 20:00", info: "Visitor check-in, badge collection and courier desk.", tags: ["visitor", "badge", "front desk"] },
        { id: "g-security", name: "Security Desk", type: "security", x: -11, z: 11, w: 6, d: 6, hours: "24 × 7" },
        { id: "g-lounge", name: "Visitor Lounge", type: "lounge", x: 13, z: 10, w: 10, d: 8 },
        { id: "g-cafeteria", name: "Cafeteria", type: "cafeteria", x: -14, z: -7, w: 20, d: 14, hours: "08:30 – 21:00", tags: ["food", "lunch", "canteen"] },
        { id: "g-training", name: "Training Centre", type: "training", x: 12, z: -7, w: 16, d: 12, capacity: "40 people" },
        { id: "g-firstaid", name: "First Aid / Medical Room", type: "firstaid", x: -24, z: 6, w: 6, d: 6, info: "Contact security for the on-duty first aider.", tags: ["medical", "doctor"] },
        ...core("g"),
      ],
    },
    { level: 1, short: "1", name: "Floor 1", rooms: deliveryFloor(1) },
    { level: 2, short: "2", name: "Floor 2", rooms: deliveryFloor(2) },
    {
      level: 3,
      short: "3",
      name: "Floor 3",
      rooms: [
        { id: "3-boardroom", name: "Board Room", type: "meeting", x: -16, z: 8, w: 20, d: 10, capacity: "20 people" },
        { id: "3-hr", name: "HR & Admin", type: "office", x: 12, z: 8, w: 16, d: 10, tags: ["hr", "admin", "id card"] },
        { id: "3-it", name: "IT Helpdesk", type: "office", x: 12, z: -8, w: 16, d: 10, hours: "09:00 – 19:00", tags: ["laptop", "support", "it"] },
        { id: "3-townhall", name: "Town Hall", type: "training", x: -14, z: -7, w: 20, d: 12, capacity: "150 people" },
        { id: "3-wellness", name: "Wellness Room", type: "wellness", x: 25, z: -6, w: 8, d: 6 },
        ...core(3),
      ],
    },
  ],
  // Predefined multi-stop journeys the agent can run as workflows.
  workflows: [
    {
      id: "new-joiner",
      name: "New joiner – Day 1",
      description: "Badge at reception, HR induction, laptop from IT, then lunch.",
      stops: ["g-reception", "3-hr", "3-it", "g-cafeteria"],
    },
    {
      id: "visitor",
      name: "Visitor journey",
      description: "Check in at reception, wait in the lounge, then the board room.",
      stops: ["g-reception", "g-lounge", "3-boardroom"],
    },
    {
      id: "wellbeing-break",
      name: "Wellbeing break",
      description: "Pantry for a coffee, then the wellness room.",
      stops: ["2-pantry", "3-wellness"],
    },
  ],
};
