// Fisher–Yates shuffle: every ordering is equally likely.
// (The common `arr.sort(() => Math.random() - 0.5)` trick is NOT uniform,
// so some nonprofits would land near the top more often than others.)
export function shuffle<T>(items: readonly T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j]!, result[i]!];
  }
  return result;
}
