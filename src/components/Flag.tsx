import { countryName } from '../lib/registrationCountry'

/**
 * Renders a country/territory flag from the local flag assets (public/flags/w{res}). Height is
 * controlled by CSS (1em) so it sits inline with text; `res` only picks the source resolution.
 */
export function Flag({
  country,
  res = 40,
  className,
}: {
  country: string | null | undefined
  res?: 20 | 40 | 80
  className?: string
}) {
  if (!country) return null
  const code = country.toLowerCase()
  const name = countryName(country) ?? country
  return (
    <img
      className={className ? `flag ${className}` : 'flag'}
      src={`${import.meta.env.BASE_URL}flags/w${res}/${code}.png`}
      alt={name}
      title={name}
      loading="lazy"
    />
  )
}
