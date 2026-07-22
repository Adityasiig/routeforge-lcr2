export const DECK_VARIANTS = ["sd", "convo"] as const;

export type DeckVariant = (typeof DECK_VARIANTS)[number];

export function isDeckVariant(value: unknown): value is DeckVariant {
  return typeof value === "string" && DECK_VARIANTS.includes(value as DeckVariant);
}

export function variantLabel(variant: DeckVariant) {
  return variant === "sd" ? "SD" : "Convo";
}
