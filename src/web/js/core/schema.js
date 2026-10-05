/**
 * Minimal JSON-Schema (draft 2020-12 subset) validator for tool inputs.
 * Supports: type (incl. arrays of types), enum, required, properties,
 * additionalProperties:false, min/max, min/maxLength, pattern, items, min/maxItems.
 */

const typeOf = (v) => {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  if (Number.isInteger(v)) return "integer";
  return typeof v;
};

const matchesType = (value, type) => {
  const actual = typeOf(value);
  return actual === type || (type === "number" && actual === "integer");
};

export function validateInput(schema, value, path = "$") {
  const errors = [];
  if (!schema) return errors;

  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((t) => matchesType(value, t))) {
      errors.push(`${path} must be ${types.join(" or ")}`);
      return errors;
    }
  }

  if (schema.enum && !schema.enum.some((e) => e === value)) {
    errors.push(`${path} must be one of: ${schema.enum.map(String).join(", ")}`);
  }

  if (typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength) errors.push(`${path} is shorter than ${schema.minLength}`);
    if (schema.maxLength !== undefined && value.length > schema.maxLength) errors.push(`${path} is longer than ${schema.maxLength}`);
    if (schema.pattern && !new RegExp(schema.pattern, "u").test(value)) errors.push(`${path} has an invalid format`);
  }

  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${path} must be >= ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${path} must be <= ${schema.maximum}`);
  }

  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) errors.push(`${path} needs at least ${schema.minItems} item(s)`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) errors.push(`${path} allows at most ${schema.maxItems} item(s)`);
    if (schema.items) value.forEach((item, i) => errors.push(...validateInput(schema.items, item, `${path}[${i}]`)));
  }

  if (typeOf(value) === "object") {
    const props = schema.properties ?? {};
    for (const key of schema.required ?? []) {
      if (value[key] === undefined) errors.push(`${path}.${key} is required`);
    }
    for (const [key, v] of Object.entries(value)) {
      if (props[key]) errors.push(...validateInput(props[key], v, `${path}.${key}`));
      else if (schema.additionalProperties === false) errors.push(`${path}.${key} is not allowed`);
    }
  }

  return errors;
}
