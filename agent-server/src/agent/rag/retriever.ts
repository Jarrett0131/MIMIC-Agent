import fs from "node:fs/promises";
import path from "node:path";

import { RAG_ENABLED } from "../../config";
import { writeStructuredLog } from "../../logging/logger";
import type { KnowledgeQuestionType } from "../../types";
import { normalizeRagQuery } from "./queryNormalization";
import { applyOptionalRerank } from "./rerank";
import type { RagEntry, RagMatch, RagRetrieveInput, RagRetrievalResult } from "./types";
import { resolveRagExperimentConfig } from "./embeddingCache";

type RawRagEntry = Partial<Omit<RagEntry, "aliases" | "keywords">> & {
  aliases?: unknown;
  keywords?: unknown;
};

type ConceptRule = {
  id: string;
  canonical: string;
  aliases: string[];
};

type HintRule<TValue extends string> = {
  value: TValue;
  aliases: string[];
};

type TextProfile = {
  normalized: string;
  tokens: Set<string>;
  concepts: Set<string>;
  categoryHints: Set<RagEntry["category"]>;
  domainHints: Set<RagEntry["domain"]>;
};

type IndexedSentence = {
  text: string;
  profile: TextProfile;
};

type IndexedRagEntry = {
  entry: RagEntry;
  titleProfile: TextProfile;
  aliasProfiles: Array<TextProfile & { raw: string }>;
  keywordProfiles: Array<TextProfile & { raw: string }>;
  contentProfile: TextProfile;
  contentSentences: IndexedSentence[];
  searchTokens: Set<string>;
  concepts: Set<string>;
};

type ScoreBreakdown = RagMatch["score_breakdown"];

const CORPUS_FILES = [
  "medical_terms.json",
  "lab_item_explanations.json",
  "mimic_field_dictionary.json",
  "diagnosis_explanations.json",
] as const;

const CONCEPT_RULES: ConceptRule[] = [
  {
    id: "wbc",
    canonical: "white blood cell",
    aliases: [
      "wbc",
      "white blood cell",
      "white blood cells",
      "white blood cell count",
      "\u767d\u7ec6\u80de",
      "\u767d\u7ec6\u80de\u8ba1\u6570",
    ],
  },
  {
    id: "glucose",
    canonical: "glucose",
    aliases: [
      "glucose",
      "blood glucose",
      "serum glucose",
      "blood sugar",
      "glucose level",
      "\u8840\u7cd6",
      "\u8461\u8404\u7cd6",
    ],
  },
  {
    id: "hemoglobin",
    canonical: "hemoglobin",
    aliases: [
      "hemoglobin",
      "haemoglobin",
      "hb",
      "\u8840\u7ea2\u86cb\u767d",
    ],
  },
  {
    id: "heart-rate",
    canonical: "heart rate",
    aliases: [
      "heart rate",
      "pulse",
      "hr",
      "\u5fc3\u7387",
      "\u8109\u640f",
    ],
  },
  {
    id: "blood-pressure",
    canonical: "blood pressure",
    aliases: [
      "blood pressure",
      "bp",
      "\u8840\u538b",
      "\u6536\u7f29\u538b",
      "\u8212\u5f20\u538b",
    ],
  },
  {
    id: "charttime",
    canonical: "charttime",
    aliases: [
      "charttime",
      "chart time",
      "recorded time",
      "record time",
      "observation time",
      "\u56fe\u8868\u65f6\u95f4",
      "\u8bb0\u5f55\u65f6\u95f4",
      "\u89c2\u5bdf\u65f6\u95f4",
    ],
  },
  {
    id: "hadm-id",
    canonical: "hadm_id",
    aliases: [
      "hadm_id",
      "hadm id",
      "hospital admission id",
      "hospitalization admission id",
      "admission id",
      "\u4f4f\u9662\u53f7",
      "\u4f4f\u9662\u53f7\u5b57\u6bb5",
      "\u4f4f\u9662\u6807\u8bc6",
    ],
  },
];

const CATEGORY_HINT_RULES: HintRule<RagEntry["category"]>[] = [
  {
    value: "field",
    aliases: ["field", "column", "\u5b57\u6bb5", "\u5217\u540d"],
  },
  {
    value: "metric",
    aliases: [
      "metric",
      "indicator",
      "lab",
      "vital",
      "\u6307\u6807",
      "\u5316\u9a8c",
      "\u68c0\u9a8c",
      "\u751f\u547d\u4f53\u5f81",
    ],
  },
  {
    value: "term",
    aliases: ["term", "abbreviation", "\u7f29\u5199", "\u672f\u8bed"],
  },
  {
    value: "diagnosis",
    aliases: ["diagnosis", "icd", "\u8bca\u65ad"],
  },
  {
    value: "knowledge",
    aliases: ["knowledge", "explain", "meaning", "\u89e3\u91ca", "\u542b\u4e49"],
  },
];

const DOMAIN_HINT_RULES: HintRule<RagEntry["domain"]>[] = [
  {
    value: "lab",
    aliases: [
      "lab",
      "glucose",
      "wbc",
      "hemoglobin",
      "creatinine",
      "lactate",
      "\u8840\u7cd6",
      "\u767d\u7ec6\u80de",
      "\u8840\u7ea2\u86cb\u767d",
      "\u5316\u9a8c",
      "\u68c0\u9a8c",
    ],
  },
  {
    value: "vital",
    aliases: [
      "vital",
      "heart rate",
      "pulse",
      "blood pressure",
      "temperature",
      "spo2",
      "\u5fc3\u7387",
      "\u8840\u538b",
      "\u4f53\u6e29",
      "\u8840\u6c27",
      "\u751f\u547d\u4f53\u5f81",
    ],
  },
  {
    value: "patient",
    aliases: [
      "patient",
      "admission",
      "hadm",
      "charttime",
      "\u60a3\u8005",
      "\u4f4f\u9662",
      "\u5b57\u6bb5",
      "\u8bb0\u5f55\u65f6\u95f4",
    ],
  },
  {
    value: "diagnosis",
    aliases: [
      "diagnosis",
      "icd",
      "sepsis",
      "pneumonia",
      "aki",
      "\u8bca\u65ad",
      "\u8113\u6bd2\u75c7",
      "\u80ba\u708e",
      "\u6025\u6027\u80be\u635f\u4f24",
    ],
  },
];

const SCORE_WEIGHTS = Object.freeze({
  exactTitle: 72,
  partialTitle: 44,
  exactAlias: 64,
  partialAlias: 36,
  keywordPhrase: 14,
  titleToken: 10,
  tokenOverlap: 28,
  concept: 22,
  routeCategory: 18,
  hintCategory: 8,
  domainHint: 6,
});

let corpusCache: RagEntry[] | null = null;
let indexedCorpusCache: IndexedRagEntry[] | null = null;

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function isKnownCategory(value: unknown): value is RagEntry["category"] {
  return (
    value === "metric" ||
    value === "field" ||
    value === "term" ||
    value === "diagnosis" ||
    value === "knowledge"
  );
}

function isKnownDomain(value: unknown): value is RagEntry["domain"] {
  return (
    value === "lab" ||
    value === "vital" ||
    value === "patient" ||
    value === "diagnosis" ||
    value === "general"
  );
}

function normalizeEntry(
  value: RawRagEntry,
  sourceFile: string,
  index: number,
): RagEntry | null {
  if (
    typeof value.id !== "string" ||
    typeof value.title !== "string" ||
    typeof value.content !== "string"
  ) {
    return null;
  }

  return {
    id: value.id.trim() || `${sourceFile}-${index}`,
    title: value.title.trim(),
    source:
      typeof value.source === "string" && value.source.trim()
        ? value.source.trim()
        : `docs/rag/${sourceFile}`,
    content: value.content.trim(),
    category: isKnownCategory(value.category) ? value.category : "knowledge",
    domain: isKnownDomain(value.domain) ? value.domain : "general",
    aliases: normalizeStringArray(value.aliases),
    keywords: normalizeStringArray(value.keywords),
  };
}

function normalizeText(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[_/\\-]+/g, " ")
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractTokens(normalized: string): Set<string> {
  const tokens = new Set<string>();
  const matches = normalized.match(/[a-z0-9]+|[\u4e00-\u9fff]{2,}/g) ?? [];

  matches.forEach((match) => {
    if (/^[a-z0-9]+$/.test(match)) {
      if (match.length >= 2) {
        tokens.add(match);
      }
      return;
    }

    tokens.add(match);
    for (let size = 2; size <= Math.min(4, match.length); size += 1) {
      for (let index = 0; index <= match.length - size; index += 1) {
        tokens.add(match.slice(index, index + size));
      }
    }
  });

  return tokens;
}

function addNormalizedPhraseTokens(target: Set<string>, phrase: string): void {
  extractTokens(normalizeText(phrase)).forEach((token) => {
    target.add(token);
  });
}

function detectHintValues<TValue extends string>(
  normalized: string,
  rules: HintRule<TValue>[],
): Set<TValue> {
  const matches = new Set<TValue>();

  rules.forEach((rule) => {
    const hit = rule.aliases.some((alias) => {
      const normalizedAlias = normalizeText(alias);
      return normalizedAlias.length > 0 && normalized.includes(normalizedAlias);
    });

    if (hit) {
      matches.add(rule.value);
    }
  });

  return matches;
}

function buildTextProfile(value: string): TextProfile {
  const normalized = normalizeText(value);
  const tokens = extractTokens(normalized);
  const concepts = new Set<string>();

  CONCEPT_RULES.forEach((rule) => {
    const matchedAlias = rule.aliases.find((alias) => {
      const normalizedAlias = normalizeText(alias);
      return normalizedAlias.length > 0 && normalized.includes(normalizedAlias);
    });

    if (!matchedAlias) {
      return;
    }

    concepts.add(rule.id);
    tokens.add(rule.id);
    addNormalizedPhraseTokens(tokens, rule.canonical);
    rule.aliases.forEach((alias) => {
      addNormalizedPhraseTokens(tokens, alias);
    });
  });

  return {
    normalized,
    tokens,
    concepts,
    categoryHints: detectHintValues(normalized, CATEGORY_HINT_RULES),
    domainHints: detectHintValues(normalized, DOMAIN_HINT_RULES),
  };
}

function mergeSets(...sets: Set<string>[]): Set<string> {
  const merged = new Set<string>();
  sets.forEach((set) => {
    set.forEach((item) => {
      merged.add(item);
    });
  });
  return merged;
}

function splitContentIntoSentences(content: string): string[] {
  const segments = content
    .split(/(?<=[.!?。！？；;])\s*/u)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);

  return segments.length > 0 ? segments : [content.trim()];
}

function indexEntry(entry: RagEntry): IndexedRagEntry {
  const titleProfile = buildTextProfile(entry.title);
  const aliasProfiles = entry.aliases.map((alias) => ({
    raw: alias,
    ...buildTextProfile(alias),
  }));
  const keywordProfiles = entry.keywords.map((keyword) => ({
    raw: keyword,
    ...buildTextProfile(keyword),
  }));
  const contentProfile = buildTextProfile(entry.content);
  const contentSentences = splitContentIntoSentences(entry.content).map((sentence) => ({
    text: sentence,
    profile: buildTextProfile(sentence),
  }));

  const searchTokens = mergeSets(
    titleProfile.tokens,
    contentProfile.tokens,
    ...aliasProfiles.map((profile) => profile.tokens),
    ...keywordProfiles.map((profile) => profile.tokens),
  );
  const concepts = mergeSets(
    titleProfile.concepts,
    contentProfile.concepts,
    ...aliasProfiles.map((profile) => profile.concepts),
    ...keywordProfiles.map((profile) => profile.concepts),
  );

  return {
    entry,
    titleProfile,
    aliasProfiles,
    keywordProfiles,
    contentProfile,
    contentSentences,
    searchTokens,
    concepts,
  };
}

async function findDocsDirectory(): Promise<string | null> {
  const candidates = [
    path.resolve(process.cwd(), "docs/rag"),
    path.resolve(process.cwd(), "../docs/rag"),
    path.resolve(__dirname, "../../../../docs/rag"),
  ];

  for (const candidate of candidates) {
    try {
      const stats = await fs.stat(candidate);
      if (stats.isDirectory()) {
        return candidate;
      }
    } catch {
      // Ignore missing directories and continue checking fallback candidates.
    }
  }

  return null;
}

async function loadCorpus(): Promise<RagEntry[]> {
  if (corpusCache) {
    return corpusCache;
  }

  const docsDirectory = await findDocsDirectory();
  if (!docsDirectory) {
    writeStructuredLog("rag.corpus.missing", {
      detail: "docs/rag directory was not found.",
      created_at: new Date().toISOString(),
    });
    corpusCache = [];
    indexedCorpusCache = [];
    return corpusCache;
  }

  const entries: RagEntry[] = [];

  for (const fileName of CORPUS_FILES) {
    const filePath = path.join(docsDirectory, fileName);

    try {
      const rawText = await fs.readFile(filePath, "utf8");
      const parsed = JSON.parse(rawText) as unknown;
      if (!Array.isArray(parsed)) {
        continue;
      }

      parsed.forEach((item, index) => {
        if (typeof item !== "object" || item === null) {
          return;
        }

        const normalized = normalizeEntry(item as RawRagEntry, fileName, index);
        if (normalized) {
          entries.push(normalized);
        }
      });
    } catch (error: unknown) {
      const detail =
        error instanceof Error && error.message.trim()
          ? error.message
          : "Unknown corpus loading error.";

      writeStructuredLog("rag.corpus.file_failed", {
        file: filePath,
        detail,
        created_at: new Date().toISOString(),
      });
    }
  }

  corpusCache = entries;
  indexedCorpusCache = entries.map(indexEntry);
  return corpusCache;
}

export async function loadRagCorpus(): Promise<RagEntry[]> {
  return loadCorpus();
}

async function loadIndexedCorpus(): Promise<IndexedRagEntry[]> {
  if (indexedCorpusCache) {
    return indexedCorpusCache;
  }

  await loadCorpus();
  indexedCorpusCache = (corpusCache ?? []).map(indexEntry);
  return indexedCorpusCache;
}

function getRouteCategoryBonus(
  routeType: KnowledgeQuestionType,
  entry: RagEntry,
): number {
  switch (routeType) {
    case "field_explanation":
      return entry.category === "field" ? SCORE_WEIGHTS.routeCategory : 0;
    case "metric_explanation":
      return entry.category === "metric" ? SCORE_WEIGHTS.routeCategory : 0;
    case "term_explanation":
      return entry.category === "term" || entry.category === "diagnosis"
        ? SCORE_WEIGHTS.routeCategory
        : 0;
    case "knowledge_query":
      return entry.category === "knowledge" ? Math.round(SCORE_WEIGHTS.routeCategory / 2) : 0;
    default:
      return 0;
  }
}

function intersectSets(left: Set<string>, right: Set<string>): string[] {
  const intersection: string[] = [];
  left.forEach((value) => {
    if (right.has(value)) {
      intersection.push(value);
    }
  });
  return intersection;
}

function phraseWeight(
  queryProfile: TextProfile,
  candidateProfile: TextProfile,
  exactWeight: number,
  partialWeight: number,
): number {
  if (!candidateProfile.normalized) {
    return 0;
  }

  if (queryProfile.normalized === candidateProfile.normalized) {
    return exactWeight;
  }

  return queryProfile.normalized.includes(candidateProfile.normalized) ? partialWeight : 0;
}

function scoreTokenOverlap(queryProfile: TextProfile, entry: IndexedRagEntry): number {
  const sharedTitleTokens = intersectSets(queryProfile.tokens, entry.titleProfile.tokens);
  const sharedSearchTokens = intersectSets(queryProfile.tokens, entry.searchTokens);

  const titleScore = sharedTitleTokens.length * SCORE_WEIGHTS.titleToken;
  if (sharedSearchTokens.length === 0) {
    return titleScore;
  }

  const ratio =
    sharedSearchTokens.length /
    Math.max(queryProfile.tokens.size, Math.min(entry.searchTokens.size, 12), 1);

  return titleScore + Math.round(ratio * SCORE_WEIGHTS.tokenOverlap);
}

function scoreConceptOverlap(queryProfile: TextProfile, entry: IndexedRagEntry): number {
  const sharedConcepts = intersectSets(queryProfile.concepts, entry.concepts);
  return sharedConcepts.length * SCORE_WEIGHTS.concept;
}

function buildMatchedTerms(
  queryProfile: TextProfile,
  entry: IndexedRagEntry,
): string[] {
  const matched = new Set<string>();

  if (
    queryProfile.normalized.includes(entry.titleProfile.normalized) &&
    entry.entry.title.trim().length > 0
  ) {
    matched.add(entry.entry.title);
  }

  entry.aliasProfiles.forEach((profile) => {
    if (profile.normalized && queryProfile.normalized.includes(profile.normalized)) {
      matched.add(profile.raw);
    }
  });

  entry.keywordProfiles.forEach((profile) => {
    if (profile.normalized && queryProfile.normalized.includes(profile.normalized)) {
      matched.add(profile.raw);
    }
  });

  intersectSets(queryProfile.concepts, entry.concepts).forEach((conceptId) => {
    const conceptRule = CONCEPT_RULES.find((rule) => rule.id === conceptId);
    matched.add(conceptRule?.canonical ?? conceptId);
  });

  return [...matched].slice(0, 6);
}

function scoreEntry(
  queryProfile: TextProfile,
  routeType: KnowledgeQuestionType,
  entry: IndexedRagEntry,
): { score: number; scoreBreakdown: ScoreBreakdown; matchedTerms: string[] } {
  const exact = phraseWeight(
    queryProfile,
    entry.titleProfile,
    SCORE_WEIGHTS.exactTitle,
    SCORE_WEIGHTS.partialTitle,
  );

  const alias = entry.aliasProfiles.reduce((maxScore, profile) => {
    const weight = phraseWeight(
      queryProfile,
      profile,
      SCORE_WEIGHTS.exactAlias,
      SCORE_WEIGHTS.partialAlias,
    );
    return Math.max(maxScore, weight);
  }, 0);

  const keyword = Math.min(
    entry.keywordProfiles.reduce((total, profile) => {
      if (!profile.normalized || !queryProfile.normalized.includes(profile.normalized)) {
        return total;
      }

      return total + SCORE_WEIGHTS.keywordPhrase;
    }, 0),
    SCORE_WEIGHTS.keywordPhrase * 2,
  );

  const token_overlap = scoreTokenOverlap(queryProfile, entry);
  const concept = scoreConceptOverlap(queryProfile, entry);
  const category =
    getRouteCategoryBonus(routeType, entry.entry) +
    (queryProfile.categoryHints.has(entry.entry.category) ? SCORE_WEIGHTS.hintCategory : 0);
  const domain = queryProfile.domainHints.has(entry.entry.domain) ? SCORE_WEIGHTS.domainHint : 0;

  const lexicalScore = exact + alias + keyword + token_overlap + concept;
  const scoreBreakdown: ScoreBreakdown = {
    exact,
    alias,
    keyword,
    token_overlap,
    concept,
    category,
    domain,
  };

  const score = lexicalScore + category + domain;
  if (lexicalScore < 12 || score < 18) {
    return {
      score: 0,
      scoreBreakdown,
      matchedTerms: [],
    };
  }

  return {
    score,
    scoreBreakdown,
    matchedTerms: buildMatchedTerms(queryProfile, entry),
  };
}

function scoreSentence(queryProfile: TextProfile, sentence: IndexedSentence): number {
  const tokenHits = intersectSets(queryProfile.tokens, sentence.profile.tokens).length;
  const conceptHits = intersectSets(queryProfile.concepts, sentence.profile.concepts).length;
  return tokenHits * 6 + conceptHits * 18;
}

function pickBestChunk(queryProfile: TextProfile, entry: IndexedRagEntry): string {
  if (entry.contentSentences.length === 0) {
    return entry.entry.content;
  }

  const rankedSentences = entry.contentSentences
    .map((sentence, index) => ({
      sentence,
      index,
      score: scoreSentence(queryProfile, sentence),
    }))
    .sort((left, right) => right.score - left.score);

  const best = rankedSentences[0];
  if (!best || best.score <= 0) {
    return entry.contentSentences[0]?.text ?? entry.entry.content;
  }

  const parts = [best.sentence.text];
  const nextSentence = rankedSentences.find(
    (candidate) => candidate.index === best.index + 1 && candidate.score > 0,
  );

  if (best.sentence.text.length < 80 && nextSentence) {
    parts.push(nextSentence.sentence.text);
  }

  return parts.join(" ").trim();
}

function toMatch(
  queryProfile: TextProfile,
  entry: IndexedRagEntry,
  score: number,
  matchedTerms: string[],
  scoreBreakdown: ScoreBreakdown,
): RagMatch {
  return {
    id: entry.entry.id,
    title: entry.entry.title,
    source: entry.entry.source,
    chunk: pickBestChunk(queryProfile, entry),
    score,
    category: entry.entry.category,
    domain: entry.entry.domain,
    matched_terms: matchedTerms,
    score_breakdown: scoreBreakdown,
  };
}

export function resetRagCorpusCache(): void {
  corpusCache = null;
  indexedCorpusCache = null;
}

export async function retrieveRagMatches(
  input: RagRetrieveInput,
): Promise<RagRetrievalResult> {
  if (!RAG_ENABLED) {
    return {
      enabled: false,
      retriever: "hybrid",
      items: [],
      reason: "RAG is disabled by configuration.",
    };
  }

  const indexedCorpus = await loadIndexedCorpus();
  if (indexedCorpus.length === 0) {
    return {
      enabled: true,
      retriever: "hybrid",
      items: [],
      reason: "RAG corpus is empty.",
    };
  }

  const normalizedQuery = await normalizeRagQuery({
    question: input.question,
    routeType: input.routeType,
  });
  const effectiveQuestion = normalizedQuery.normalized_query || input.question;
  const queryProfile = buildTextProfile(effectiveQuestion);
  const experimentConfig = resolveRagExperimentConfig(input.experiment);
  const requestedLimit = input.limit ?? 3;
  const candidateLimit =
    experimentConfig.rerankEnabled || experimentConfig.embeddingCacheEnabled
      ? Math.max(requestedLimit, experimentConfig.candidateLimit)
      : requestedLimit;
  const ranked = indexedCorpus
    .map((entry) => {
      const scored = scoreEntry(queryProfile, input.routeType, entry);
      return {
        entry,
        ...scored,
      };
    })
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, candidateLimit)
    .map((item) =>
      toMatch(
        queryProfile,
        item.entry,
        item.score,
        item.matchedTerms,
        item.scoreBreakdown,
      ),
    );

  if (!experimentConfig.rerankEnabled) {
    return {
      enabled: true,
      retriever: "hybrid",
      items: ranked.slice(0, requestedLimit),
      reason:
        ranked.length === 0
          ? "No matching knowledge entries were found. 未找到相关知识条目，但我仍然可以尝试回答您的问题。"
          : undefined,
      experiment:
        experimentConfig.embeddingCacheEnabled
          ? {
              enabled: true,
              applied: false,
              strategy: "embedding-cache-rerank",
              provider: experimentConfig.embeddingProvider,
              model: experimentConfig.embeddingModel,
              cache_path: experimentConfig.embeddingCachePath,
              candidate_count: ranked.length,
              rescored_count: 0,
              reason: "Rerank is disabled.",
            }
          : undefined,
    };
  }

  const reranked = await applyOptionalRerank({
    question: effectiveQuestion,
    limit: requestedLimit,
    baselineItems: ranked,
    corpusEntriesById: new Map(indexedCorpus.map((entry) => [entry.entry.id, entry.entry])),
    experiment: input.experiment,
  });

  return {
    enabled: true,
    retriever: reranked.retriever,
    items: reranked.items,
    reason:
      reranked.items.length === 0
        ? "No matching knowledge entries were found. 未找到相关知识条目，但我仍然可以尝试回答您的问题。"
        : undefined,
    experiment: reranked.experiment,
  };
}
