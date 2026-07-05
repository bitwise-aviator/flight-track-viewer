/**
 * ICAO type designator -> human-readable model name, for the type codes in this dataset.
 * Grouping is done by the 4-char code, but the group is labelled and sorted by this name
 * (so "Boeing 737-800", not "B738"). Unknown codes fall back to the KML's full model string.
 */
const TYPE_NAMES: Record<string, string> = {
  A20N: 'Airbus A320neo',
  A21N: 'Airbus A321neo',
  A318: 'Airbus A318',
  A319: 'Airbus A319',
  A320: 'Airbus A320',
  A321: 'Airbus A321',
  A332: 'Airbus A330-200',
  A333: 'Airbus A330-300',
  A339: 'Airbus A330-900',
  A359: 'Airbus A350-900',
  BCS1: 'Airbus A220-100',
  B39M: 'Boeing 737 MAX 9',
  B712: 'Boeing 717-200',
  B737: 'Boeing 737-700',
  B738: 'Boeing 737-800',
  B739: 'Boeing 737-900',
  B752: 'Boeing 757-200',
  B763: 'Boeing 767-300',
  B764: 'Boeing 767-400',
  B772: 'Boeing 777-200',
  B77W: 'Boeing 777-300ER',
  B788: 'Boeing 787-8',
  B789: 'Boeing 787-9',
  CRJ9: 'Bombardier CRJ900',
  CRJX: 'Bombardier CRJ1000',
  E170: 'Embraer 170',
  E190: 'Embraer 190',
  E295: 'Embraer E195-E2',
  E75S: 'Embraer 175',
}

/** Readable model name for a type code, falling back to the KML full model, then the code. */
export function modelName(type: string | null, fullModel: string | null): string {
  if (type && TYPE_NAMES[type]) return TYPE_NAMES[type]
  return fullModel ?? type ?? 'Unknown aircraft'
}

/** Hyphen-insensitive, case-insensitive registration key so "PHBVB" and "PH-BVB" group together. */
export function registrationKey(reg: string): string {
  return reg.replace(/-/g, '').toUpperCase()
}

/**
 * Best display form for a registration among the variants seen for one tail. FR24 data already
 * follows each country's convention (N123AB, PH-BVG, F-GRHI, HL8085, JA626A, HP-9908CMP, B-18306),
 * so we prefer a variant that carries a hyphen when the country uses one.
 */
export function displayRegistration(variants: readonly string[]): string {
  const hyphenated = variants.find((r) => r.includes('-'))
  return (hyphenated ?? variants[0]).toUpperCase()
}
