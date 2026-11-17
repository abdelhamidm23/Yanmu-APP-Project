/** Picks the Arabic or English name of a bilingual row. */
export function localName(row: { nameAr: string; nameEn: string }, locale: string): string {
  return locale === "ar" ? row.nameAr : row.nameEn;
}
