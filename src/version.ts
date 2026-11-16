/** What is running: the commit that was built and the moment of the build (the release), both set at build time by vite.config.ts. */
export const BUILD_COMMIT = __BUILD_COMMIT__;
export const BUILD_DATE = __BUILD_DATE__;

/** The first 7 characters of a commit, the way git shows it. */
export const shortCommit = (commit: string): string => commit.slice(0, 7);

/** The release date in the reader's language, or null when the build has none (or a date that cannot be read). */
export function releaseDate(iso: string, locale: string): string | null {
  const date = new Date(iso);
  if (!iso || Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeZone: 'UTC' }).format(date);
}
