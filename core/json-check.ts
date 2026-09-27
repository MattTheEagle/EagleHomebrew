// Diagnostic mirror of Eagle Flight Control's own `isJsonValue` (EagleFlightControl/core/json-value.ts), which
// rejects a `document.update` request's whole payload as soon as any single value anywhere in it fails — without
// saying which one (M7 rework Runde 3, live-check finding 14: the rejection kept recurring after two rework
// attempts with no way to see which value was at fault). This walks the same rules but returns the first offending
// path instead of a plain boolean, so a live-check can report exactly where the problem is instead of only that
// there is one.

function isPlainObject(value: object): boolean {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

// Returns the dotted/bracketed path of the first value that would make Flight Control's own check reject this
// object (e.g. "system.activities.abc123.damage.parts.0.types"), or undefined if the whole tree is JSON-safe.
export function findJsonViolation(value: unknown, path = "$", ancestors = new Set<object>()): string | undefined {
  if (value === null) return undefined;
  switch (typeof value) {
    case "boolean":
    case "string":
      return undefined;
    case "number":
      return Number.isFinite(value) ? undefined : `${path} (number, not finite: ${String(value)})`;
    case "object": {
      if (ancestors.has(value)) return `${path} (cycle)`;
      ancestors.add(value);
      try {
        if (Array.isArray(value)) {
          for (let index = 0; index < value.length; index++) {
            const found = findJsonViolation(value[index], `${path}[${index}]`, ancestors);
            if (found) return found;
          }
          return undefined;
        }
        if (!isPlainObject(value)) return `${path} (not a plain object: ${value.constructor?.name ?? typeof value})`;
        for (const [key, item] of Object.entries(value)) {
          const found = findJsonViolation(item, `${path}.${key}`, ancestors);
          if (found) return found;
        }
        return undefined;
      } finally {
        ancestors.delete(value);
      }
    }
    default:
      return `${path} (${typeof value})`; // undefined, function, symbol, bigint
  }
}
