/** Migration files still to apply, in order. File names are the versions (e.g. 0001_initial_schema.sql). */
export function pendingMigrations(fileNames: readonly string[], appliedVersions: ReadonlySet<string>): string[] {
  return fileNames
    .filter((name) => name.endsWith('.sql') && !appliedVersions.has(name))
    .sort();
}
