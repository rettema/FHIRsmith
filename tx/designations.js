const { LanguagePartType, Languages, Language} = require('../library/languages');
const { TypeHelper } = require('./type-helpers');
const {validateParameter, validateOptionalParameter, validateArrayParameter} = require("../library/utilities");

/**
 * Display checking modes for concept designations
 */
const DisplayCheckingStyle = {
  EXACT: 'exact',
  CASE_INSENSITIVE: 'caseInsensitive',
  NORMALISED: 'normalised'
};

/**
 * Text search filter with stemming support
 */
class SearchFilterText {
  constructor(filter) {
    validateParameter(filter, 'filter', String);

    this.filter = filter.toLowerCase();
    this.stems = [];
    this._process();
  }

  /**
   * Check if filter is empty
   */
  get null() {
    return this.stems.length === 0;
  }

  /**
   * Check if a value passes the filter
   */
  passes(value, returnRating = false) {
    validateParameter(value, 'value', String);
    validateOptionalParameter(returnRating, 'returnRating', Boolean);

    if (this.null) {
      return returnRating ? {passes: true, rating: 0} : true;
    }

    let rating = 0;
    let i = 0;

    while (i < value.length) {
      if (this._isAlphaNumeric(value[i])) {
        const j = i;
        while (i < value.length && this._isAlphaNumeric(value[i])) {
          i++;
        }
        const word = value.substring(j, i).toLowerCase();
        const stemmed = this._stem(word);

        if (this._find(stemmed)) {
          if (returnRating) {
            rating += value.length / this.stems.length;
            return {passes: true, rating};
          } else {
            return true;
          }
        }
      } else {
        i++;
      }
    }

    return returnRating ? {passes: false, rating: 0} : false;
  }

  /**
   * Check if designations pass the filter
   */
  passesDesignations(cds) {
    validateOptionalParameter(cds, 'cds', Designations);

    if (!cds) return false;

    if (this.null) {
      return cds.designations.some(cd => cd.value && cd.value.value);
    }

    for (const cd of cds.designations) {
      if (cd.value && this.passes(cd.value.value)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Calculate match score against stems
   */
  matches(stems) {
    validateOptionalParameter(stems, 'stems', Array);

    if (this.stems.length === 0) return 100;
    if (!stems || stems.length === 0) return 0;

    let result = 0;

    for (const stem of stems) {
      let incomplete = false;
      let complete = false;

      for (const filterStem of this.stems) {
        if (filterStem === stem) {
          complete = true;
        } else if (stem.startsWith(filterStem)) {
          incomplete = true;
        }
      }

      if (complete) {
        result += stem.length / this.stems.length;
      } else if (incomplete) {
        result += (stem.length / this.stems.length) / 2;
      }
    }

    return result;
  }

  // Private methods

  _process() {
    let i = 0;

    while (i < this.filter.length) {
      if (this._isAlphaNumeric(this.filter[i])) {
        const j = i;
        while (i < this.filter.length && this._isAlphaNumeric(this.filter[i])) {
          i++;
        }
        const word = this.filter.substring(j, i);
        this.stems.push(this._stem(word));
      } else {
        i++;
      }
    }

    this.stems.sort();
  }

  _isAlphaNumeric(char) {
    return /[0-9a-zA-Z]/.test(char);
  }

  _stem(word) {
    // Simple stemming - in practice you'd want a proper stemmer
    return word.toLowerCase();
  }

  _find(stem) {
    // Binary search
    let left = 0;
    let right = this.stems.length - 1;

    while (left <= right) {
      const mid = Math.floor((left + right) / 2);
      const midStem = this.stems[mid];

      if (stem.startsWith(midStem)) {
        return true;
      } else if (stem < midStem) {
        right = mid - 1;
      } else {
        left = mid + 1;
      }
    }

    return false;
  }
}

  /**
   * Display difference types
   */
  const DisplayDifference = {
    DIFFERENT: 'different',
    CASE: 'case',
    NORMALISED: 'normalised'
  };

  /**
   * Language matching types
   */
  const LangMatchType = {
    LITERAL: 'literal',
    FULL: 'full',
    LANG_REGION: 'langRegion',
    LANG: 'lang'
  };

  /**
   * Individual concept designation with language, use, and value
   */
  class Designation {
  constructor() {
    this.base = false;
    this.active = false;
    this.language = null;
    this.use = null; // TFHIRCoding equivalent: {system, version, code, display}
    this.value = null; // TFHIRPrimitive equivalent: {value, extension, id}
    this.extensions = []; // Array of extension objects
  }

  /**
   * Get the display text for this designation
   */
  get display() {
    return this.value ? this.value.value || '' : '';
  }

  /**
   * Get a string representation of this designation
   */
  present() {
    let result = this.value ? `"${this.value.value || ''}"` : '""';

    if (this.language || this.use) {
      result += ' (';
      if (this.language) {
        result += this.language.code;
      }
      if (this.use) {
        result += '/' + this._renderCoding(this.use);
      }
      result += ')';
    }

    return result;
  }

  /**
   * Render a coding object as text
   */
  _renderCoding(coding) {
    if (!coding) return '--';
    if (coding.display) return coding.display;
    if (coding.code) return coding.code;
    return coding.system || '--';
  }
}

/**
 * Collection of concept designations with language matching and preference logic
 */
class Designations {
  constructor(languageDefinitions) {
    this.languageDefinitions = languageDefinitions;
    this.baseLang = null;
    this.designations = [];
    this.source = null; // Reference to CodeSystemProvider
  }

  /**
   * Clear all designations and reset base language
   */
  clear() {
    this.baseLang = null;
    this.designations = [];
  }

  /**
   * Add a designation with string parameters
   */
  addDesignation(base, active, isDisplay, lang, display) {
    validateParameter(base, "base", Boolean);
    validateParameter(active, "active", Boolean);
    validateParameter(isDisplay, "isDisplay", Boolean);
    validateParameter(lang, "lang", String);
    validateParameter(display, "display", String);

    const designation = new Designation();
    designation.language = this.languageDefinitions.parse(lang);
    designation.value = TypeHelper.makeString(display);
    designation.base = base;
    designation.active = active;

    if (isDisplay) {
      designation.use = {
        system: 'http://terminology.hl7.org/CodeSystem/hl7TermMaintInfra',
        code: 'preferredForLanguage'
      };
    }

    this.designations.push(designation);
    return designation;
  }

  /**
   * Add designations from an array of displays
   */
  addDesignationsFromArray(base, active, isDisplay, lang, displays) {
    validateParameter(base, "base", Boolean);
    validateParameter(active, "active", Boolean);
    validateParameter(isDisplay, "isDisplay", Boolean);
    validateParameter(lang, "lang", String);
    validateArrayParameter(displays, "displays", String, false);

    if (displays) {
      for (const display of displays) {
        this.addDesignation(base, active, isDisplay, lang, display);
      }
    }
  }

  /**
   * Add a designation with primitive value and extensions
   */
  addDesignationWithValue(base, active, isDisplay, lang, value, extensions = null) {
    validateParameter(base, "base", Boolean);
    validateParameter(active, "active", Boolean);
    validateParameter(isDisplay, "isDisplay", Boolean);
    validateParameter(lang, "lang", String);
    validateParameter(value, "value", Object, false);
    validateArrayParameter(extensions, "extensions", Object, true);

    const designation = new Designation();
    designation.language = this.languageDefinitions.parse(lang);
    designation.value = value; // Use value directly
    designation.base = base;
    designation.active = active;

    if (extensions) {
      designation.extensions = [...extensions]; // Copy array
    }

    if (isDisplay) {
      designation.use = {
        system: 'http://terminology.hl7.org/CodeSystem/hl7TermMaintInfra',
        code: 'preferredForLanguage'
      };
    }

    this.designations.push(designation);
    return designation;
  }

  /**
   * Add designation from FHIR CodeSystem concept designation
   */
  addDesignationFromConcept(ccd) {
    validateParameter(ccd, 'ccd', Object);
    const designation = new Designation();
    designation.language = this.languageDefinitions.parse(ccd.language);
    designation.use = ccd.use;
    designation.value = TypeHelper.readString(ccd, "value");

    // Handle extensions
    if (ccd.hasExtensions) {
      const sctExtensions = ccd.getExtensions('http://hl7.org/fhir/StructureDefinition/coding-sctdescid');
      if (sctExtensions && sctExtensions.length > 0) {
        designation.extensions = [...sctExtensions];
      }
    }

    this.designations.push(designation);
    return designation;
  }

  /**
   * Add designation from FHIR ValueSet include concept designation
   */
  addDesignationFromValueSet(ccd) {
    validateParameter(ccd, 'ccd', Object);
    const designation = new Designation();
    designation.language = this.languageDefinitions.parse(ccd.language);
    designation.use = ccd.use;
    designation.value = TypeHelper.readString(ccd, "value");

    // Handle extensions
    if (ccd.hasExtensions) {
      const sctExtensions = ccd.getExtensions('http://hl7.org/fhir/StructureDefinition/coding-sctdescid');
      if (sctExtensions && sctExtensions.length > 0) {
        designation.extensions = [...sctExtensions];
      }
    }

    this.designations.push(designation);
    return designation;
  }

  /**
   * Check if a display value exists with specified matching criteria
   */
  hasDisplay(langList, defLang, value, active, mode) {
    validateParameter(langList, 'langList', Languages, true); // Allow null
    validateOptionalParameter(defLang, 'defLang', Language);
    validateParameter(value, 'value', String);
    validateParameter(active, 'active', Boolean);
    validateParameter(mode, 'mode', String);

    const result = { hasDisplay: false, difference: DisplayDifference.DIFFERENT };

    for (const cd of this.designations) {
      if (this._langsMatch(langList, cd.language, LangMatchType.LANG, defLang) &&
        (!active || cd.active) &&
        cd.value &&
        this._stringMatches(value, cd.value.value, mode, cd.language)) {
        result.hasDisplay = true;
        return result;
      }
    }

    if (mode === DisplayCheckingStyle.EXACT) {
      for (const cd of this.designations) {
        if (this._langsMatch(langList, cd.language, LangMatchType.LANG, defLang) &&
          (!active || cd.active) &&
          cd.value &&
          this._stringMatches(value, cd.value.value, DisplayCheckingStyle.CASE_INSENSITIVE, cd.language)) {
          result.difference = DisplayDifference.CASE;
          return result;
        }
      }
    }

    if (mode !== DisplayCheckingStyle.NORMALISED) {
      for (const cd of this.designations) {
        if (this._langsMatch(langList, cd.language, LangMatchType.LANG, defLang) &&
          (!active || cd.active) &&
          cd.value &&
          this._stringMatches(value, cd.value.value, DisplayCheckingStyle.NORMALISED, cd.language)) {
          result.difference = DisplayDifference.NORMALISED;
          return result;
        }
      }
    }

    return result;
  }

  /**
   * Count displays matching language criteria
   */
  displayCount(langList, defLang, displayOnly) {
    validateParameter(langList, 'langList', Languages, true); // Allow null
    validateOptionalParameter(defLang, 'defLang', Language);
    validateParameter(displayOnly, 'displayOnly', Boolean);

    let result = 0;

    // Try full match first
    for (const cd of this.designations) {
      if ((!displayOnly || cd.base || this._isDisplay(cd)) &&
        this._langsMatch(langList, cd.language, LangMatchType.FULL, defLang) &&
        cd.value) {
        result++;
      }
    }

    if (result === 0) {
      // Try language-region match
      for (const cd of this.designations) {
        if ((!displayOnly || cd.base || this._isDisplay(cd)) &&
          this._langsMatch(langList, cd.language, LangMatchType.LANG_REGION, defLang) &&
          cd.value) {
          result++;
        }
      }
    }

    if (result === 0) {
      // Try language-only match
      for (const cd of this.designations) {
        if ((!displayOnly || cd.base || this._isDisplay(cd)) &&
          this._langsMatch(langList, cd.language, LangMatchType.LANG, defLang) &&
          cd.value) {
          result++;
        }
      }
    }

    return result;
  }

  /**
   * Present all matching designations as a formatted string
   */
  present(langList, defLang, displayOnly) {
    validateParameter(langList, 'langList', Languages, true); // Allow null
    validateOptionalParameter(defLang, 'defLang', Language);
    validateParameter(displayOnly, 'displayOnly', Boolean);

    const results = [];
    let count = 0;

    // Collect matching designations
    for (const cd of this.designations) {
      if ((!displayOnly || cd.base || this._isDisplay(cd)) &&
        this._langsMatch(langList, cd.language, LangMatchType.LANG, null) &&
        cd.value) {
        count++;
        if (cd.language) {
          results.push(`'${cd.display}' (${cd.language.code})`);
        } else {
          results.push(`'${cd.display}'`);
        }
      }
    }

    // If no language-specific matches, get all
    if (count === 0) {
      for (const cd of this.designations) {
        if ((!displayOnly || cd.base || this._isDisplay(cd)) && cd.value) {
          count++;
          if (cd.language) {
            results.push(`'${cd.display}' (${cd.language.code})`);
          } else {
            results.push(`'${cd.display}'`);
          }
        }
      }
    }

    return this._joinWithOr(results);
  }

  /**
   * Check if designation should be included for given language criteria
   */
  include(cd, langList, defLang) {
    validateParameter(cd, 'cd', Designation);
    validateParameter(langList, 'langList', Languages, true); // Allow null
    validateOptionalParameter(defLang, 'defLang', Language);

    return this._langsMatch(langList, cd.language, LangMatchType.LANG, defLang);
  }

  /**
   * Find the preferred designation for given language preferences
   */
  preferredDesignation(langList = null) {
    if (this.designations.length === 0) {
      return null;
    }

    if (!langList || langList.languages.length == 0) {
      // No language list, prefer base designations
      for (const cd of this.designations) {
        if (cd.base) {
          return cd;
        }
      }
      for (const cd of this.designations) {
        if (this._isDisplay(cd)) {
          return cd;
        }
      }
      return this.designations[0];
    }

    // Collect all valid matches with their scores
    const allMatches = [];

    for (const lang of langList.languages) {
      if (lang.quality <= 0) continue;

      const matchTypes = [LangMatchType.FULL, LangMatchType.LANG_REGION, LangMatchType.LANG];

      for (const matchType of matchTypes) {
        for (const cd of this.designations) {
          if (this._langMatches(lang, cd.language, matchType)) {
            allMatches.push({
              designation: cd,
              language: lang,
              matchType: matchType,
              quality: lang.quality
            });
          }
        }
      }
    }

    if (allMatches.length === 0) {
      return null;
    }

    // Now select the best match from all collected matches
    return this._selectBestMatch(allMatches);
  }

  /**
   * Select the best designation from all collected matches
   */
  _selectBestMatch(matches) {
    // Sort by priority:
    // 1. Match type (FULL > LANG_REGION > LANG)
    // 2. Language quality
    // 3. Designation type (base > display > other)
    // 4. Language specificity (exact language > regional variant)

    const matchTypePriority = {
      [LangMatchType.FULL]: 3,
      [LangMatchType.LANG_REGION]: 2,
      [LangMatchType.LANG]: 1
    };

    const getDesignationTypePriority = (cd) => {
      if (cd.base) return 3;
      if (this._isDisplay(cd)) return 2;
      return 1;
    };

    const getLanguageSpecificity = (cd) => {
      // For same match type, prefer exact language over regional variants
      // Shorter language codes are more general (fr vs fr-CA)
      const code = cd.language?.code || '';
      return -code.length; // Negative so shorter codes sort first
    };

    matches.sort((a, b) => {
      // 1. Language quality
      const qualityDiff = b.quality - a.quality;
      if (qualityDiff !== 0) return qualityDiff;

      // 2. Match type priority
      const matchTypeDiff = matchTypePriority[b.matchType] - matchTypePriority[a.matchType];
      if (matchTypeDiff !== 0) return matchTypeDiff;

      // 3. Designation type
      const designationTypeDiff = getDesignationTypePriority(b.designation) - getDesignationTypePriority(a.designation);
      if (designationTypeDiff !== 0) return designationTypeDiff;

      // 4. Language specificity (for same match type, prefer more specific matches)
      return getLanguageSpecificity(b.designation) - getLanguageSpecificity(a.designation);
    });

    return matches[0].designation;
  }

  /**
   * Get preferred display text
   */
  preferredDisplay(langList, defLang) {
    const cd = this.preferredDesignation(langList, defLang);
    return cd ? cd.display : '';
  }

  /**
   * Get summary of all designations
   */
  summary() {
    return this.designations.map(cd => cd.present()).join(', ');
  }

  /**
   * Present this designations object
   */
  presentSelf() {
    let result = this.baseLang ? `Lang: ${this.baseLang.code}` : 'Lang: ??';
    if (this.source) {
      result += `; source: ${this.source.constructor.name}`;
    }
    return result;
  }

  /**
   * Get language code for base language
   */
  get langCode() {
    return this.baseLang ? this.baseLang.code : 'en';
  }

  /**
   * Get count of designations
   */
  get count() {
    return this.designations.length;
  }

  // Private helper methods

  /**
   * Check if designation is a display designation
   */
  _isDisplay(cd) {
    return !cd.use ||
      (cd.use.system === 'http://terminology.hl7.org/CodeSystem/hl7TermMaintInfra' &&
        cd.use.code === 'preferredForLanguage') ||
      (cd.use.system === 'http://terminology.hl7.org/CodeSystem/designation-usage' &&
        cd.use.code === 'display');
  }

  /**
   * Get depth for match type
   */
  _depthForMatchType(matchType) {
    switch (matchType) {
      case LangMatchType.LITERAL:
      case LangMatchType.FULL:
        return LanguagePartType.EXTENSION;
      case LangMatchType.LANG_EXACT:
        return LanguagePartType.REGION;
      case LangMatchType.LANG_REGION:
        return LanguagePartType.REGION;
      case LangMatchType.LANG:
        return LanguagePartType.LANGUAGE;
      default:
        return LanguagePartType.EXTENSION;
    }
  }

  /**
   * Check if a single language entry matches a stated language
   */
  _langMatches(langEntry, statedLang, matchType) {
    const actualLang = statedLang || this.baseLang;

    if (langEntry.quality <= 0) {
      return false;
    }

    if (langEntry.code === '*' && matchType !== LangMatchType.LITERAL) {
      return true;
    }

    if (actualLang) {
      if (matchType === LangMatchType.LITERAL) {
        return langEntry.code === actualLang.code;
      }

      // Parse the language entry if needed
      let parsedLang = langEntry;
      if (typeof langEntry.code === 'string') {
        parsedLang = this.languageDefinitions.parse(langEntry.code);
      }

      if (parsedLang && parsedLang.matches(actualLang, this._depthForMatchType(matchType))) {
        return true;
      }
    }

    return false;
  }

  /**
   * Check if language list matches stated language
   */
  _langsMatch(langList, statedLang, matchType, defLang) {
    if (defLang && statedLang && statedLang.matches(defLang)) {
      return true;
    }

    if (!statedLang || !langList) {
      return true;
    }

    for (const langEntry of langList.languages) {
      if (this._langMatches(langEntry, statedLang, matchType)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Check if strings match according to specified mode
   */
  _stringMatches(source, possible, mode) {
    // We ignore lang parameter for now, like the Pascal version
    switch (mode) {
      case DisplayCheckingStyle.EXACT:
        return source === possible;
      case DisplayCheckingStyle.CASE_INSENSITIVE:
        return source.toLowerCase() === possible.toLowerCase();
      case DisplayCheckingStyle.NORMALISED:
        return this._normalizeWhitespace(source).toLowerCase() ===
          this._normalizeWhitespace(possible).toLowerCase();
      default:
        return false;
    }
  }

  /**
   * Normalize whitespace in a string
   */
  _normalizeWhitespace(str) {
    return str.replace(/\s+/g, ' ').trim();
  }

  /**
   * Join array with commas and final "or"
   */
  _joinWithOr(items) {
    if (items.length === 0) return '';
    if (items.length === 1) return items[0];
    if (items.length === 2) return `${items[0]} or ${items[1]}`;

    const lastItem = items.pop();
    return `${items.join(', ')}, or ${lastItem}`;
  }
}

module.exports = {
  Designation,
  Designations,
  SearchFilterText,
  DisplayCheckingStyle,
  DisplayDifference,
  LangMatchType
};