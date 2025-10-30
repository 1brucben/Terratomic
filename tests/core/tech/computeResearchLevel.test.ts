import {
  computeResearchLevel,
  getTechNodes,
} from "../../../src/core/tech/ResearchTree";

// Helper to pick IDs for a specific level
function idsForLevel(level: number): string[] {
  return getTechNodes()
    .filter((n) => n.level === level)
    .map((n) => n.id);
}

describe("computeResearchLevel", () => {
  it("returns 1 with no researched techs", () => {
    const T = computeResearchLevel([]);
    expect(T).toBeCloseTo(1, 6);
  });

  it("returns 2.0 when all level 1 techs are researched", () => {
    const level1 = idsForLevel(1);
    expect(level1.length).toBeGreaterThan(0);
    const T = computeResearchLevel(level1);
    // 1 (base) + 1 (level 1 completion) = 2
    expect(T).toBeCloseTo(2, 6);
  });

  it("weights 80% additive and 20% highest level (partial L1)", () => {
    const level1 = idsForLevel(1);
    // Use half of L1 (floored). Note: level1 count may be odd, so ratio isn't always 0.5.
    const picked = level1.slice(0, Math.floor(level1.length / 2));
    const halfL1 = new Set<string>(picked);
    const ratio = picked.length / level1.length; // fraction of L1 researched
    const expected = 0.8 * (1 + ratio) + 0.2 * (1 + 1); // additive + highest+1
    const T_halfL1 = computeResearchLevel(halfL1);
    expect(T_halfL1).toBeCloseTo(expected, 6);
  });

  it("gives ~2.6 when L1 complete and L2 50% complete (approx)", () => {
    const level1 = idsForLevel(1);
    const level2 = idsForLevel(2);
    const halfL2Count = Math.floor(level2.length / 2);
    const chosenL2 = level2.slice(0, halfL2Count);
    const T = computeResearchLevel([...level1, ...chosenL2]);
    const ratioL2 = halfL2Count / level2.length;
    const expected = 0.8 * (1 + 1 + ratioL2) + 0.2 * (2 + 1);
    expect(T).toBeCloseTo(expected, 6);
  });
});
