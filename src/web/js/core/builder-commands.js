const NUMBER = "(-?\\d+(?:\\.\\d+)?)";
const CATEGORY = "meeting room|meeting|office|lift|elevator|stairs|staircase|restroom|pantry|cafeteria|workspace|room|space";

export function parseBuilderCommand(text) {
  const input = String(text ?? "").trim().replace(/[.!?]$/, "");
  let match = input.match(/^add (?:a |an )?(?:new )?floor(?: (?:called |named )?(.+))?$/i);
  if (match) return { type: "add_floor", name: match[1]?.trim() };

  match = input.match(/^rename (?:the )?(?:active )?floor (?:to )?(.+)$/i);
  if (match) return { type: "rename_floor", name: match[1].trim() };

  match = input.match(/^name (?:the )?building (.+)$/i);
  if (match) return { type: "rename_building", name: match[1].trim() };

  match = input.match(new RegExp(`^set (?:the )?(?:building )?(width|depth) (?:to )?${NUMBER}\\s*(?:m|metres?)?$`, "i"));
  if (match) return { type: "set_dimension", field: match[1].toLowerCase(), value: Number(match[2]) };

  match = input.match(new RegExp(`^add (?:a |an )?(?:(\\d+(?:\\.\\d+)?)\\s*(?:m)?\\s*(?:by|x)\\s*(\\d+(?:\\.\\d+)?)\\s*(?:m)?\\s+)?(${CATEGORY})(?: (?:called|named) (.+?))?(?: on (?:floor )?(-?\\d+|ground(?: floor)?))?$`, "i"));
  if (match) {
    const category = match[3].toLowerCase();
    const types = { "meeting room": "meeting", elevator: "lift", staircase: "stairs", room: "other", space: "other" };
    return {
      type: "add_room",
      roomType: types[category] ?? category,
      width: match[1] ? Number(match[1]) : undefined,
      depth: match[2] ? Number(match[2]) : undefined,
      name: match[4]?.trim(),
      floor: match[5]?.toLowerCase(),
    };
  }

  match = input.match(new RegExp(`^move (.+?) to ${NUMBER}\\s*[, ]\\s*${NUMBER}$`, "i"));
  if (match) return { type: "move_room", name: match[1].trim(), x: Number(match[2]), z: Number(match[3]) };

  match = input.match(/^rename (?:room|space) (.+?) to (.+)$/i);
  if (match) return { type: "rename_room", name: match[1].trim(), newName: match[2].trim() };

  match = input.match(/^(delete|duplicate) (?:room|space) (.+)$/i);
  if (match) return { type: `${match[1].toLowerCase()}_room`, name: match[2].trim() };

  match = input.match(/^(?:show|select) (?:floor )?(-?\d+|ground(?: floor)?)$/i);
  if (match) return { type: "select_floor", floor: match[1].toLowerCase() };
  return null;
}