import { describe, it, expect } from 'vitest';
import { parseSearchQuery, matchSearchQuery } from '../../src/shared/searchUtils.ts';

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
});