import { describe, it, expect } from 'vitest';
import { parseSearchQuery, matchSearchQuery, fuzzyMatch, fuzzyScore } from '../../src/shared/searchUtils.ts';

describe('parseSearchQuery', () => {
  it('parses simple single keyword as optional', () => {
    const result = parseSearchQuery('foo');
    expect(result.optionalTerms).toEqual(['foo']);
    expect(result.requiredTerms).toEqual([]);
    expect(result.exactPhrase).toBeNull();
  });

  it('parses multiple space-separated keywords as OR', () => {
    const result = parseSearchQuery('foo bar');
    expect(result.optionalTerms).toEqual(['foo', 'bar']);
    expect(result.requiredTerms).toEqual([]);
    expect(result.exactPhrase).toBeNull();
  });

  it('parses + prefixed keywords as required (AND)', () => {
    const result = parseSearchQuery('+foo +bar');
    expect(result.requiredTerms).toEqual(['foo', 'bar']);
    expect(result.optionalTerms).toEqual([]);
    expect(result.exactPhrase).toBeNull();
  });

  it('parses mixed required and optional keywords', () => {
    const result = parseSearchQuery('+foo bar');
    expect(result.requiredTerms).toEqual(['foo']);
    expect(result.optionalTerms).toEqual(['bar']);
    expect(result.exactPhrase).toBeNull();
  });

  it('parses quoted exact phrase', () => {
    const result = parseSearchQuery('"foo bar"');
    expect(result.exactPhrase).toBe('foo bar');
    expect(result.optionalTerms).toEqual(['foo bar']);
    expect(result.requiredTerms).toEqual([]);
  });

  it('parses quoted phrase with additional keywords', () => {
    const result = parseSearchQuery('"foo bar" baz');
    expect(result.exactPhrase).toBe('foo bar');
    expect(result.optionalTerms).toEqual(['baz']);
    expect(result.requiredTerms).toEqual([]);
  });

  it('parses quoted phrase with required keyword', () => {
    const result = parseSearchQuery('+baz "foo bar"');
    expect(result.exactPhrase).toBe('foo bar');
    expect(result.requiredTerms).toEqual(['baz']);
    expect(result.optionalTerms).toEqual([]);
  });

  it('handles empty query', () => {
    const result = parseSearchQuery('');
    expect(result.optionalTerms).toEqual([]);
    expect(result.requiredTerms).toEqual([]);
    expect(result.exactPhrase).toBeNull();
  });

  it('handles query with only spaces', () => {
    const result = parseSearchQuery('   ');
    expect(result.optionalTerms).toEqual([]);
    expect(result.requiredTerms).toEqual([]);
    expect(result.exactPhrase).toBeNull();
  });

  it('handles + with no term after it', () => {
    const result = parseSearchQuery('+');
    expect(result.requiredTerms).toEqual([]);
    expect(result.optionalTerms).toEqual([]);
  });
});

describe('matchSearchQuery', () => {
  it('matches single optional term', () => {
    const parsed = parseSearchQuery('foo');
    expect(matchSearchQuery('foobar', parsed)).toBe(true);
    expect(matchSearchQuery('baz', parsed)).toBe(false);
  });

  it('matches any optional term (OR logic)', () => {
    const parsed = parseSearchQuery('foo bar');
    expect(matchSearchQuery('foobar', parsed)).toBe(true);
    expect(matchSearchQuery('barbaz', parsed)).toBe(true);
    expect(matchSearchQuery('baz', parsed)).toBe(false);
  });

  it('requires all required terms (AND logic)', () => {
    const parsed = parseSearchQuery('+foo +bar');
    expect(matchSearchQuery('foobar', parsed)).toBe(true);
    expect(matchSearchQuery('foobaz', parsed)).toBe(false);
    expect(matchSearchQuery('barbaz', parsed)).toBe(false);
  });

  it('requires required terms AND at least one optional term', () => {
    const parsed = parseSearchQuery('+foo bar baz');
    expect(matchSearchQuery('foobar', parsed)).toBe(true);
    expect(matchSearchQuery('foobaz', parsed)).toBe(true);
    expect(matchSearchQuery('fooqux', parsed)).toBe(false);
    expect(matchSearchQuery('barbaz', parsed)).toBe(false);
  });

  it('matches exact phrase', () => {
    const parsed = parseSearchQuery('"foo bar"');
    expect(matchSearchQuery('foo bar baz', parsed)).toBe(true);
    expect(matchSearchQuery('foobar', parsed)).toBe(false);
  });

  it('is case-insensitive', () => {
    const parsed = parseSearchQuery('FOO');
    expect(matchSearchQuery('Foobar', parsed)).toBe(true);
  });

  it('matches everything when query is empty', () => {
    const parsed = parseSearchQuery('');
    expect(matchSearchQuery('anything', parsed)).toBe(true);
  });

  it('uses fuzzyMatch for optional terms that are not exact substrings', () => {
    const parsed = parseSearchQuery('fbr');
    expect(matchSearchQuery('foobar', parsed)).toBe(true);
  });
});

describe('fuzzyMatch', () => {
  it('returns true for empty pattern', () => {
    expect(fuzzyMatch('anything', '')).toBe(true);
  });

  it('returns false when pattern is longer than text', () => {
    expect(fuzzyMatch('ab', 'abc')).toBe(false);
  });

  it('matches exact substring', () => {
    expect(fuzzyMatch('foobar', 'bar')).toBe(true);
  });

  it('matches fuzzy subsequence', () => {
    expect(fuzzyMatch('foobar', 'fbr')).toBe(true);
  });

  it('returns false for non-matching subsequence', () => {
    expect(fuzzyMatch('foobar', 'xyz')).toBe(false);
  });

  it('matches single character', () => {
    expect(fuzzyMatch('abc', 'a')).toBe(true);
    expect(fuzzyMatch('abc', 'c')).toBe(true);
  });

  it('matches full pattern as subsequence', () => {
    expect(fuzzyMatch('abcdefgh', 'aceh')).toBe(true);
  });

  it('returns false when characters are out of order', () => {
    expect(fuzzyMatch('abc', 'ba')).toBe(false);
  });
});

describe('fuzzyScore', () => {
  it('returns 0 for empty pattern', () => {
    expect(fuzzyScore('anything', '')).toBe(0);
  });

  it('returns high score for exact substring match', () => {
    const score = fuzzyScore('foobar', 'bar');
    expect(score).toBeGreaterThan(100);
  });

  it('returns 0 when pattern is not a subsequence', () => {
    expect(fuzzyScore('abc', 'xyz')).toBe(0);
  });

  it('returns positive score for fuzzy subsequence match', () => {
    const score = fuzzyScore('foobar', 'fbr');
    expect(score).toBeGreaterThan(0);
  });

  it('gives higher score for consecutive matches', () => {
    const consecutiveScore = fuzzyScore('abcdefgh', 'abc');
    const scatteredScore = fuzzyScore('abcdefgh', 'adg');
    expect(consecutiveScore).toBeGreaterThan(scatteredScore);
  });

  it('is case-insensitive', () => {
    expect(fuzzyScore('FOOBAR', 'bar')).toBeGreaterThan(100);
    expect(fuzzyScore('foobar', 'BAR')).toBeGreaterThan(100);
  });

  it('returns 0 for pattern longer than text', () => {
    expect(fuzzyScore('ab', 'abc')).toBe(0);
  });

  it('rewards longer substring matches proportionally', () => {
    const shortMatch = fuzzyScore('ab', 'ab');
    const longMatch = fuzzyScore('abcdef', 'def');
    expect(longMatch).toBeGreaterThan(0);
  });
});