declare module 'tz-lookup' {
  /** Returns the IANA timezone name for a coordinate, e.g. "America/New_York". */
  const tzlookup: (lat: number, lon: number) => string
  export default tzlookup
}
