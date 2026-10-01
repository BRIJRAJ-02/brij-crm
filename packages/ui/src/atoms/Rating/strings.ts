/** Rating's built in copy. */
export const strings = {
  stars: (count: number) => (count === 1 ? '1 star' : `${String(count)} stars`),
  rated: (label: string, value: number | null) =>
    value === null ? `${label}: no rating` : `${label}: ${String(value)} out of 5 stars`,
} as const;
