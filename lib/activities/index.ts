/**
 * Public barrel for the activity config registry. Consumers ALWAYS import from here
 * (`lib/activities`) so we have one stable surface even if internals reshape later.
 */
export * from "./types";
export * from "./registry";
