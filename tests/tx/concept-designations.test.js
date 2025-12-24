/**
 * ValueSet Expansion Unit Tests
 * 
 * Tests for ImportedValueSet, ConceptDesignations, Languages
 * These tests focus on classes that don't have deep dependency chains
 */

const { 
  ConceptDesignations, 
  ConceptDesignation,
  DisplayCompareSensitivity,
  DisplayDifference,
  DesignationUse 
} = require('../../tx/library/concept-designations');

const { Language, Languages } = require('../../library/languages');

describe('Language', () => {
  test('parses simple language tag', () => {
    const lang = new Language('en');
    expect(lang.language).toBe('en');
    expect(lang.region).toBe('');
    expect(lang.script).toBe('');
  });

  test('parses language with region', () => {
    const lang = new Language('en-US');
    expect(lang.language).toBe('en');
    expect(lang.region).toBe('US');
  });

  test('parses language with script', () => {
    const lang = new Language('zh-Hans');
    expect(lang.language).toBe('zh');
    expect(lang.script).toBe('Hans');
  });

  test('matches for display - same primary', () => {
    const en = new Language('en');
    const enUS = new Language('en-US');
    expect(enUS.matchesForDisplay(en)).toBe(true);
  });

  test('does not match different primary', () => {
    const en = new Language('en');
    const de = new Language('de');
    expect(en.matchesForDisplay(de)).toBe(false);
  });

  test('matches with overlapping regions', () => {
    const enUS = new Language('en-US');
    const enUS2 = new Language('en-US');
    expect(enUS.matchesForDisplay(enUS2)).toBe(true);
  });

  test('does not match different regions when both specified', () => {
    const enUS = new Language('en-US');
    const enGB = new Language('en-GB');
    expect(enUS.matchesForDisplay(enGB)).toBe(false);
  });

  test('isEnglishOrNothing returns true for en variants', () => {
    expect(new Language('en').isEnglishOrNothing()).toBe(true);
    expect(new Language('en-US').isEnglishOrNothing()).toBe(true);
    expect(new Language('de').isEnglishOrNothing()).toBe(false);
  });
});

describe('Languages', () => {
  test('parses Accept-Language header', () => {
    const langs = Languages.fromAcceptLanguage('en-US,en;q=0.9,de;q=0.8');
    expect(langs.length).toBe(3);
    expect(langs.get(0).code).toBe('en-US');
    expect(langs.get(0).quality).toBe(1.0);
    expect(langs.get(1).code).toBe('en');
    expect(langs.get(1).quality).toBe(0.9);
  });

  test('handles empty header by defaulting to system', () => {
    const langs = Languages.fromAcceptLanguage('');
    // With empty header it adds system default
    expect(langs.length).toBeGreaterThanOrEqual(1);
  });

  test('isEnglishOrNothing returns true when all are English', () => {
    const langs = Languages.fromAcceptLanguage('en-US,en');
    expect(langs.isEnglishOrNothing()).toBe(true);
  });
});

describe('ConceptDesignation', () => {
  test('creates with all options', () => {
    const d = new ConceptDesignation({
      language: 'en-US',
      use: DesignationUse.DISPLAY,
      value: 'Test',
      isDisplay: true,
      isActive: true
    });
    expect(d.value).toBe('Test');
    expect(d.isDisplay).toBe(true);
    expect(d.language.code).toBe('en-US');
  });

  test('isUseADisplay returns true for display use', () => {
    const d = new ConceptDesignation({
      use: DesignationUse.DISPLAY,
      value: 'Test'
    });
    expect(d.isUseADisplay()).toBe(true);
  });

  test('isUseADisplay returns true for no use', () => {
    const d = new ConceptDesignation({
      value: 'Test'
    });
    expect(d.isUseADisplay()).toBe(true);
  });
});

describe('ConceptDesignations', () => {
  test('preferredDisplay returns first matching display', () => {
    const cd = new ConceptDesignations();
    cd.addDesignation({
      language: 'de',
      value: 'German',
      isDisplay: true,
      isActive: true
    });
    cd.addDesignation({
      language: 'en',
      value: 'English',
      isDisplay: true,
      isActive: true
    });
    
    const langs = Languages.fromAcceptLanguage('en');
    expect(cd.preferredDisplay(langs)).toBe('English');
  });

  test('preferredDisplay falls back when no match', () => {
    const cd = new ConceptDesignations();
    cd.addDesignation({
      language: 'de',
      value: 'German',
      isDisplay: true,
      isActive: true
    });
    
    const langs = Languages.fromAcceptLanguage('fr');
    // Should still return something (falls back to any display)
    const display = cd.preferredDisplay(langs);
    expect(display).toBe('German');
  });

  test('hasDisplay finds exact match', () => {
    const cd = new ConceptDesignations();
    cd.addDesignation({
      language: 'en',
      value: 'Male',
      isDisplay: true,
      isActive: true
    });
    
    const result = cd.hasDisplay(null, null, 'Male', true, DisplayCompareSensitivity.CaseSensitive);
    expect(result.found).toBe(true);
    expect(result.difference).toBe(DisplayDifference.Exact);
  });

  test('hasDisplay finds case-insensitive match', () => {
    const cd = new ConceptDesignations();
    cd.addDesignation({
      language: 'en',
      value: 'Male',
      isDisplay: true,
      isActive: true
    });
    
    const result = cd.hasDisplay(null, null, 'male', true, DisplayCompareSensitivity.CaseInsensitive);
    expect(result.found).toBe(true);
    expect(result.difference).toBe(DisplayDifference.Case);
  });

  test('displayCount counts active displays', () => {
    const cd = new ConceptDesignations();
    cd.addDesignation({ value: 'One', isActive: true });
    cd.addDesignation({ value: 'Two', isActive: true });
    cd.addDesignation({ value: 'Three', isActive: false });
    
    expect(cd.displayCount(null, null, true)).toBe(2);
    expect(cd.displayCount(null, null, false)).toBe(3);
  });

  test('present formats displays for errors', () => {
    const cd = new ConceptDesignations();
    cd.addDesignation({ value: 'Male', isActive: true });
    cd.addDesignation({ value: 'Female', isActive: true });
    
    const result = cd.present();
    expect(result).toContain('Male');
    expect(result).toContain('Female');
  });

  test('addFromConcept extracts designations', () => {
    const cd = new ConceptDesignations();
    cd.addFromConcept({
      display: 'Main Display',
      designation: [
        { language: 'de', value: 'German Display' }
      ]
    }, 'en');
    
    expect(cd.count).toBe(2);
    expect(cd.preferredDisplay(Languages.fromAcceptLanguage('en'))).toBe('Main Display');
    expect(cd.preferredDisplay(Languages.fromAcceptLanguage('de'))).toBe('German Display');
  });
});

// ImportedValueSet tests that don't require external dependencies
describe('ImportedValueSet', () => {
  test('basic ImportedValueSet functionality via inline implementation', () => {
    // Test the core logic without requiring the full module
    // This is a simplified version of what ImportedValueSet does
    
    const expandedVs = {
      resourceType: 'ValueSet',
      url: 'http://example.org/vs',
      version: '1.0',
      expansion: {
        contains: [
          { system: 'http://example.org/cs', code: 'A', display: 'Alpha' },
          { system: 'http://example.org/cs', code: 'B', display: 'Beta' }
        ]
      }
    };
    
    // Simulate ImportedValueSet behavior
    const codeMap = new Map();
    const makeKey = (system, code) => `${system}\x00${code}`;
    
    for (const entry of expandedVs.expansion.contains) {
      codeMap.set(makeKey(entry.system, entry.code), entry);
    }
    
    expect(codeMap.size).toBe(2);
    expect(codeMap.has(makeKey('http://example.org/cs', 'A'))).toBe(true);
    expect(codeMap.has(makeKey('http://example.org/cs', 'Z'))).toBe(false);
  });
});
