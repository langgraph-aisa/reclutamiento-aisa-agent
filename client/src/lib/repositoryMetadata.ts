import { APP_VERSION, PRODUCT_NAME, RELEASE_BRANCH } from "@shared/release";

export type RepositoryLanguage = {
  name: string;
  percentage: number;
};

const FALLBACK_LANGUAGES: RepositoryLanguage[] = [
  { name: "TypeScript", percentage: 88.2 },
  { name: "Typst", percentage: 4.9 },
  { name: "JavaScript", percentage: 3 },
  { name: "Python", percentage: 2.7 },
  { name: "CSS", percentage: 0.5 },
  { name: "PLpgSQL", percentage: 0.5 },
  { name: "Other", percentage: 0.2 },
];

function safePercentage(value: string | undefined) {
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? Math.max(0, Math.min(100, Math.round(parsed)))
    : 0;
}

function repositoryLanguages(): RepositoryLanguage[] {
  try {
    const parsed = JSON.parse(
      import.meta.env.VITE_REPOSITORY_LANGUAGES || "[]"
    );
    if (!Array.isArray(parsed) || !parsed.length) return FALLBACK_LANGUAGES;
    const languages = parsed.filter(
      (item): item is RepositoryLanguage =>
        typeof item?.name === "string" &&
        typeof item?.percentage === "number" &&
        item.percentage >= 0
    );
    return languages.length ? languages : FALLBACK_LANGUAGES;
  } catch {
    return FALLBACK_LANGUAGES;
  }
}

export const REPOSITORY_METADATA = {
  product: PRODUCT_NAME,
  version: APP_VERSION,
  branch: import.meta.env.VITE_BUILD_BRANCH || RELEASE_BRANCH,
  commit: import.meta.env.VITE_BUILD_COMMIT || "local",
  githubSyncPercentage: safePercentage(
    import.meta.env.VITE_GITHUB_SYNC_PERCENTAGE
  ),
  languages: repositoryLanguages(),
} as const;
