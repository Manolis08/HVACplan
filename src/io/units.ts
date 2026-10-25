export type Unit = 'mm' | 'cm' | 'm' | 'in';
export type UpAxis = 'Y' | 'Z';

export const UNITS: { id: Unit; label: string; toMm: number }[] = [
  { id: 'mm', label: 'mm', toMm: 1 },
  { id: 'cm', label: 'cm', toMm: 10 },
  { id: 'm', label: 'm', toMm: 1000 },
  { id: 'in', label: 'in', toMm: 25.4 },
];

export const unitToMm = (u: Unit) => UNITS.find((x) => x.id === u)!.toMm;
