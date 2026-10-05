export interface CompanyRef {
  slug: string;
  name: string;
  aliases: string[];
}

export function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function normalizeName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Exact match on slug, name, or alias. Zero or multiple matches do not resolve. */
export function resolveCompany(companies: CompanyRef[], input: string): CompanyRef | null {
  const normalized = normalizeName(input);
  const slug = slugify(input);
  const matches = companies.filter((company) => {
    if (company.slug === slug) return true;
    if (normalizeName(company.name) === normalized) return true;
    return company.aliases.some((alias) => normalizeName(alias) === normalized);
  });
  if (matches.length !== 1) return null;
  return matches[0] ?? null;
}