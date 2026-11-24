// units.mjs の型（tests/ui/ui-check-units.test.ts が使う）
export declare const UNITS: { id: string; weight: number }[];
export declare const UNIT_IDS: string[];
export declare function unitOfPath(path: string): string | null;
export declare function recordUnitOf(slug: string): string | null;
export declare function reviewUnitOf(slug: string): string | null;
export declare function coverageErrors(): string[];
export declare function unitsForChanges(files: string[]): { units: string[]; allBy: string[] };
