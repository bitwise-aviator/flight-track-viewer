import countryNames from './countryNames.json'

/**
 * Aircraft registration nationality prefixes -> ISO 3166-1 alpha-2 country code (ICAO Doc 7910).
 * Not exhaustive, but covers the world's major registries plus every prefix in this dataset.
 * The shared "B" prefix (China / Taiwan / Hong Kong / Macau) is disambiguated separately.
 */
const PREFIX: Record<string, string> = {
  // one-letter
  N: 'US',
  F: 'FR',
  G: 'GB',
  D: 'DE',
  I: 'IT',
  C: 'CA',
  // two-letter / alphanumeric
  A6: 'AE',
  A7: 'QA',
  A9: 'BH',
  AP: 'PK',
  CC: 'CL',
  CN: 'MA',
  CP: 'BO',
  CS: 'PT',
  CU: 'CU',
  D2: 'AO',
  E7: 'BA',
  EC: 'ES',
  EI: 'IE',
  EK: 'AM',
  EP: 'IR',
  ER: 'MD',
  ES: 'EE',
  ET: 'EG',
  EW: 'BY',
  EX: 'KG',
  EY: 'TJ',
  EZ: 'TM',
  HA: 'HU',
  HB: 'CH',
  HC: 'EC',
  HH: 'HT',
  HI: 'DO',
  HK: 'CO',
  HL: 'KR',
  HP: 'PA',
  HR: 'HN',
  HS: 'TH',
  HZ: 'SA',
  JA: 'JP',
  JU: 'RS',
  JY: 'JO',
  LN: 'NO',
  LV: 'AR',
  LX: 'LU',
  LY: 'LT',
  LZ: 'BG',
  OB: 'PE',
  OD: 'LB',
  OE: 'AT',
  OH: 'FI',
  OK: 'CZ',
  OM: 'SK',
  OO: 'BE',
  OY: 'DK',
  P2: 'PG',
  P4: 'AW',
  PH: 'NL',
  PJ: 'CW',
  PK: 'ID',
  PP: 'BR',
  PR: 'BR',
  PT: 'BR',
  PU: 'BR',
  PZ: 'SR',
  RA: 'RU',
  RP: 'PH',
  S2: 'BD',
  S5: 'SI',
  SE: 'SE',
  SP: 'PL',
  SU: 'EG',
  SX: 'GR',
  TC: 'TR',
  TF: 'IS',
  TG: 'GT',
  TI: 'CR',
  TS: 'TN',
  UK: 'UZ',
  UP: 'KZ',
  UR: 'UA',
  VH: 'AU',
  VN: 'VN',
  VP: 'GB',
  VQ: 'GB',
  VT: 'IN',
  XA: 'MX',
  XB: 'MX',
  XC: 'MX',
  YL: 'LV',
  YR: 'RO',
  YU: 'RS',
  YV: 'VE',
  ZA: 'AL',
  ZK: 'NZ',
  ZP: 'PY',
  ZS: 'ZA',
  ZT: 'ZA',
  ZU: 'ZA',
  '4K': 'AZ',
  '4L': 'GE',
  '4R': 'LK',
  '4X': 'IL',
  '5B': 'CY',
  '5N': 'NG',
  '5Y': 'KE',
  '7T': 'DZ',
  '9A': 'HR',
  '9H': 'MT',
  '9K': 'KW',
  '9M': 'MY',
  '9N': 'NP',
  '9V': 'SG',
  '9Y': 'TT',
}

/** The "B" prefix is shared; disambiguate by the pattern after it. */
function disambiguateB(rest: string): string {
  if (/^M/.test(rest)) return 'MO' // Macau: B-Mxx
  if (/^[HKLN]/.test(rest)) return 'HK' // Hong Kong: B-Hxx / Kxx / Lxx / Nxx
  if (/^\d{5}/.test(rest)) return 'TW' // Taiwan: B-##### (5 digits)
  return 'CN' // Mainland China: B-#### or B-##XX
}

/** ISO 3166-1 alpha-2 country code for an aircraft registration, or null if unknown. */
export function registrationCountry(registration: string | null | undefined): string | null {
  if (!registration) return null
  const reg = registration.toUpperCase().trim()
  if (!reg) return null

  if (reg[0] === 'B') return disambiguateB(reg.replace(/^B-?/, ''))

  const compact = reg.replace(/-/g, '')
  return PREFIX[compact.slice(0, 2)] ?? PREFIX[compact.slice(0, 1)] ?? null
}

/** Human-readable country name for an ISO 3166-1 alpha-2 code. */
export function countryName(code: string | null | undefined): string | undefined {
  if (!code) return undefined
  return (countryNames as Record<string, string>)[code.toLowerCase()]
}
