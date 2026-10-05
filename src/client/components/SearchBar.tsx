import React, { useState, useRef, useEffect, memo } from 'react';
import { useT } from '../i18n/index.ts';
import { SearchIcon, CloseIcon } from './Icons.tsx';

export interface SearchResultItem {
  id: string;
  label: string;
  type: string;
  filePath: string;
}

interface SearchBarProps {
  query: string;
  matchCount: number | null;
  searchResults: SearchResultItem[];
  onChange: (q: string) => void;
  onClose: () => void;
  onSelectResult: (id: string) => void;
}

export const SearchBar = memo(function SearchBar({ query, matchCount, searchResults, onChange, onClose, onSelectResult }: SearchBarProps) {
  const t = useT();
  const [showResults, setShowResults] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    triggerRef.current = document.activeElement as HTMLElement;
    return () => {
      triggerRef.current?.focus();
    };
  }, []);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowResults(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  useEffect(() => {
    setActiveIndex(-1);
  }, [query]);

  useEffect(() => {
    if (activeIndex < 0) return;
    const list = listRef.current;
    if (!list) return;
    const item = list.children[activeIndex] as HTMLElement;
    if (item) item.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  const handleSelect = (id: string) => {
    onSelectResult(id);
    setShowResults(false);
    setActiveIndex(-1);
    onClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onClose();
      return;
    }
    if (!showResults || searchResults.length === 0) return;
    const maxIdx = Math.min(searchResults.length, 10) - 1;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((prev) => prev < maxIdx ? prev + 1 : 0);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((prev) => prev > 0 ? prev - 1 : maxIdx);
    } else if (e.key === 'Enter' && activeIndex >= 0 && activeIndex < displayResults.length) {
      e.preventDefault();
      handleSelect(displayResults[activeIndex]!.id);
    }
  };

  const displayResults = searchResults.slice(0, 10);

  return (
    <div className="cg-search-bar" ref={containerRef}>
      <SearchIcon size={14} className="cg-search-bar-icon" />
      <input
        id="graph-search"
        name="graph-search"
        type="text"
        placeholder={t('search.placeholder')}
        value={query}
        onChange={(e) => { onChange(e.target.value); setShowResults(true); }}
        onFocus={() => setShowResults(true)}
        onKeyDown={handleKeyDown}
        autoFocus
        aria-label={t('search.placeholder')}
      />
      {/* cg-search-close-btn 是稳定寻址名：按钮只靠 aria-label 标识，
          文案随 i18n 变化，E2E 与契约测试只能锚类名。 */}
      <button className="cg-search-close-btn" onClick={onClose} aria-label={t('search.close')}><CloseIcon size={14} /></button>
      {query && matchCount !== null && (
        <span className="cg-search-hint" role="status" aria-live="polite">
          {matchCount > 0
            ? t(matchCount === 1 ? 'search.match' : 'search.matches', { n: matchCount })
            : t('search.noMatch')}
        </span>
      )}
      {!query && <span className="cg-search-hint">{t('search.debounced')}</span>}
      {showResults && query && searchResults.length > 0 && (
        <ul className="cg-search-results" role="listbox" ref={listRef}>
          {displayResults.map((item, idx) => (
            <li key={item.id} role="option" aria-selected={idx === activeIndex}
              className={`cg-search-result-item ${idx === activeIndex ? 'cg-active' : ''}`}
              onClick={() => handleSelect(item.id)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSelect(item.id); }}
              tabIndex={0}
            >
              <span className="cg-search-result-type">{item.type}</span>
              <span className="cg-search-result-label">{item.label}</span>
              <span className="cg-search-result-path">{item.filePath}</span>
            </li>
          ))}
          {searchResults.length > 10 && (
            <li className="cg-search-result-more">
              {t('search.moreResults', { n: searchResults.length - 10 })}
            </li>
          )}
        </ul>
      )}
    </div>
  );
});
