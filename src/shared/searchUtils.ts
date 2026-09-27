export interface ParsedSearchQuery {
  requiredTerms: string[];
  optionalTerms: string[];
  exactPhrase: string | null;
}

export function parseSearchQuery(query: string): ParsedSearchQuery {
  const requiredTerms: string[] = [];
  const optionalTerms: string[] = [];
  let exactPhrase: string | null = null;

  const quotedMatch = query.match(/"([^"]+)"/);
  if (quotedMatch) {
    exactPhrase = quotedMatch[1]!.toLowerCase();
  }

  const remaining = query.replace(/"[^"]+"/g, ' ').trim();
  if (remaining) {
    for (const token of remaining.split(/\s+/)) {
      if (token.startsWith('+')) {
        const term = token.slice(1).toLowerCase();
        if (term) requiredTerms.push(term);
      } else {
        optionalTerms.push(token.toLowerCase());
      }
    }
  }

  if (exactPhrase && optionalTerms.length === 0 && requiredTerms.length === 0) {
    optionalTerms.push(exactPhrase);
  }

  return { requiredTerms, optionalTerms, exactPhrase };
}

export function matchSearchQuery(label: string, parsed: ParsedSearchQuery): boolean {
  const lower = label.toLowerCase();
  if (parsed.exactPhrase && !lower.includes(parsed.exactPhrase)) return false;
  for (const term of parsed.requiredTerms) {
    if (!lower.includes(term)) return false;
  }
  if (parsed.optionalTerms.length > 0) {
    return parsed.optionalTerms.some((term) => lower.includes(term) || fuzzyMatch(lower, term));
  }
  return true;
}

export function fuzzyMatch(text: string, pattern: string): boolean {
  if (pattern.length === 0) return true;
  if (pattern.length > text.length) return false;
  let ti = 0;
  let pi = 0;
  while (ti < text.length && pi < pattern.length) {
    if (text[ti] === pattern[pi]) {
      pi++;
    }
    ti++;
  }
  return pi === pattern.length;
}

export function fuzzyScore(text: string, pattern: string): number {
  if (pattern.length === 0) return 1;
  const lower = text.toLowerCase();
  const pat = pattern.toLowerCase();
  if (lower.includes(pat)) {
    return 100 + (pat.length / lower.length) * 50;
  }
  let ti = 0;
  let pi = 0;
  let consecutive = 0;
  let maxConsecutive = 0;
  let score = 0;
  while (ti < lower.length && pi < pat.length) {
    if (lower[ti] === pat[pi]) {
      pi++;
      consecutive++;
      maxConsecutive = Math.max(maxConsecutive, consecutive);
      score += 1 + consecutive * 2;
    } else {
      consecutive = 0;
    }
    ti++;
  }
  if (pi !== pat.length) return 0;
  score += maxConsecutive * 5;
  return score;
}