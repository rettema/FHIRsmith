/**
 * ConceptDesignations - Manages designations/displays for a concept
 * 
 * Handles language-aware display selection, matching, and formatting
 * for FHIR terminology operations.
 */

const { Language, Languages } = require('../../library/languages');

/**
 * Display comparison sensitivity modes
 */
const DisplayCompareSensitivity = {
  CaseSensitive: 'case-sensitive',
  CaseInsensitive: 'case-insensitive',
  Normalized: 'normalized'  // Ignore whitespace differences
};

/**
 * Display difference results
 */
const DisplayDifference = {
  Exact: 'exact',
  Case: 'case',
  Normalized: 'normalized',
  None: 'none'
};

/**
 * Standard use codes for designations
 */
const DesignationUse = {
  DISPLAY: {
    system: 'http://terminology.hl7.org/CodeSystem/designation-use',
    code: 'display'
  },
  FSN: {
    system: 'http://snomed.info/sct',
    code: '900000000000003001'  // Fully Specified Name
  },
  PREFERRED: {
    system: 'http://snomed.info/sct', 
    code: '900000000000548007'  // Preferred term
  },
  SYNONYM: {
    system: 'http://snomed.info/sct',
    code: '900000000000013009'  // Synonym
  }
};

/**
 * Check if a Languages collection has a match for a given language
 * @param {Languages} langs - Languages collection
 * @param {Language|string} target - Target language to match
 * @returns {boolean}
 */
function languagesHasMatch(langs, target) {
  if (!langs || langs.length === 0) return false;
  
  const targetLang = typeof target === 'string' ? new Language(target) : target;
  
  for (const lang of langs) {
    if (lang.matchesForDisplay(targetLang)) {
      return true;
    }
  }
  return false;
}

/**
 * Represents a single designation
 */
class ConceptDesignation {
  /**
   * @param {Object} options
   * @param {Language|string} options.language - Language of the designation
   * @param {Object} options.use - Use code {system, code, display}
   * @param {string} options.value - The display text
   * @param {Array} options.extensions - FHIR extensions
   * @param {boolean} options.isDisplay - Whether this is the primary display
   * @param {boolean} options.isActive - Whether this designation is active
   */
  constructor(options = {}) {
    if (options.language instanceof Language) {
      this.language = options.language;
    } else if (options.language) {
      this.language = new Language(options.language);
    } else {
      this.language = null;
    }
    this.use = options.use || null;
    this.value = options.value || '';
    this.extensions = options.extensions || [];
    this.isDisplay = options.isDisplay !== undefined ? options.isDisplay : false;
    this.isActive = options.isActive !== undefined ? options.isActive : true;
  }

  /**
   * Check if this designation's use indicates it's a display
   * @returns {boolean}
   */
  isUseADisplay() {
    if (!this.use) {
      return true; // No use specified, assume display
    }
    
    // Check for standard display use codes
    if (this.use.system === DesignationUse.DISPLAY.system && 
        this.use.code === DesignationUse.DISPLAY.code) {
      return true;
    }
    
    // SNOMED preferred term is a display
    if (this.use.system === DesignationUse.PREFERRED.system &&
        this.use.code === DesignationUse.PREFERRED.code) {
      return true;
    }

    // No use or unknown use - treat as display
    return !this.use.code;
  }

  /**
   * Get a string representation for debugging
   * @returns {string}
   */
  present() {
    let result = `"${this.value}"`;
    if (this.language) {
      result += ` [${this.language.code}]`;
    }
    if (this.use && this.use.code) {
      result += ` (${this.use.code})`;
    }
    return result;
  }
}

/**
 * Collection of designations for a concept with language-aware operations
 */
class ConceptDesignations {
  /**
   * @param {Languages} defaultLanguages - Default languages for the operation
   */
  constructor(defaultLanguages = null) {
    /** @type {ConceptDesignation[]} */
    this.designations = [];
    
    /** @type {Language} Base language of the code system */
    this.baseLang = null;
    
    /** @type {Object} Source code system provider (for hasAnyDisplays check) */
    this.source = null;
    
    /** @type {Languages} Default languages */
    this.defaultLanguages = defaultLanguages;
  }

  /**
   * Clear all designations
   */
  clear() {
    this.designations = [];
    this.baseLang = null;
    this.source = null;
  }

  /**
   * Add a designation
   * @param {ConceptDesignation|Object} designation - Designation to add
   */
  addDesignation(designation) {
    if (designation instanceof ConceptDesignation) {
      this.designations.push(designation);
    } else if (designation && typeof designation === 'object') {
      this.designations.push(new ConceptDesignation(designation));
    }
  }

  /**
   * Add a designation from component parts
   * @param {boolean} isDisplay - Whether this is the primary display
   * @param {boolean} isActive - Whether the designation is active
   * @param {string} language - Language tag
   * @param {Object} use - Use coding
   * @param {string} value - Display text
   * @param {Array} extensions - FHIR extensions
   */
  addDesignationParts(isDisplay, isActive, language, use, value, extensions = []) {
    this.designations.push(new ConceptDesignation({
      isDisplay,
      isActive,
      language: language || null,
      use: use || null,
      value: value || '',
      extensions
    }));
  }

  /**
   * Add designations from a FHIR concept element
   * @param {Object} concept - FHIR CodeSystem concept or ValueSet concept
   * @param {string} baseLanguage - Base language of the resource
   */
  addFromConcept(concept, baseLanguage = null) {
    if (!concept) return;

    // Add the main display
    if (concept.display) {
      this.addDesignation({
        isDisplay: true,
        isActive: true,
        language: baseLanguage,
        use: DesignationUse.DISPLAY,
        value: concept.display
      });
    }

    // Add designations array
    if (concept.designation && Array.isArray(concept.designation)) {
      for (const d of concept.designation) {
        this.addDesignation({
          isDisplay: false,
          isActive: true,
          language: d.language,
          use: d.use,
          value: d.value,
          extensions: d.extension
        });
      }
    }
  }

  /**
   * Add designations from a CodeSystemProvider
   * @param {Array<Designation>} providerDesignations - Designations from provider
   */
  addFromProvider(providerDesignations) {
    if (!providerDesignations || !Array.isArray(providerDesignations)) return;

    for (const d of providerDesignations) {
      this.addDesignation({
        isDisplay: false,
        isActive: true,
        language: d.language,
        use: d.use,
        value: d.value
      });
    }
  }

  /**
   * Get the preferred display for the given languages
   * @param {Languages} languages - Preferred languages (in priority order)
   * @returns {string} The best display, or empty string if none found
   */
  preferredDisplay(languages) {
    const designation = this.preferredDesignation(languages);
    return designation ? designation.value : '';
  }

  /**
   * Get the preferred designation for the given languages
   * @param {Languages} languages - Preferred languages (in priority order)
   * @returns {ConceptDesignation|null} The best designation, or null if none found
   */
  preferredDesignation(languages) {
    if (this.designations.length === 0) {
      return null;
    }

    const langs = languages || this.defaultLanguages;

    // First pass: Look for displays matching requested languages
    if (langs && langs.length > 0) {
      for (const lang of langs) {
        for (const d of this.designations) {
          if (d.isActive && d.isUseADisplay() && d.value) {
            if (d.language && d.language.matchesForDisplay(lang)) {
              return d;
            }
          }
        }
      }
    }

    // Second pass: Look for display marked as primary with matching base language
    if (this.baseLang) {
      for (const d of this.designations) {
        if (d.isDisplay && d.isActive && d.value) {
          if (!d.language || d.language.matchesForDisplay(this.baseLang)) {
            return d;
          }
        }
      }
    }

    // Third pass: Any display-type designation
    for (const d of this.designations) {
      if (d.isActive && d.isUseADisplay() && d.value) {
        return d;
      }
    }

    // Fourth pass: Any designation with a value
    for (const d of this.designations) {
      if (d.isActive && d.value) {
        return d;
      }
    }

    // Last resort: first with value
    for (const d of this.designations) {
      if (d.value) {
        return d;
      }
    }

    return null;
  }

  /**
   * Check if the collection contains a display matching the given value
   * @param {Languages} languages - Languages to consider
   * @param {Language} defaultLang - Default language fallback
   * @param {string} display - Display text to find
   * @param {boolean} activeOnly - Only check active designations
   * @param {string} sensitivity - Comparison sensitivity mode
   * @returns {{found: boolean, difference: string}} Result with difference type
   */
  hasDisplay(languages, defaultLang, display, activeOnly = true, sensitivity = DisplayCompareSensitivity.CaseInsensitive) {
    if (!display) {
      return { found: false, difference: DisplayDifference.None };
    }

    const normalizedDisplay = this._normalize(display);
    const lowerDisplay = display.toLowerCase();

    for (const d of this.designations) {
      if (activeOnly && !d.isActive) continue;
      if (!d.value) continue;

      // Check language match
      if (languages && languages.length > 0) {
        let langMatch = false;
        if (d.language) {
          langMatch = languagesHasMatch(languages, d.language);
        } else if (defaultLang) {
          langMatch = true; // No language = matches default
        }
        if (!langMatch && !this._matchesBaseLang(d, defaultLang)) {
          continue;
        }
      }

      // Compare display values
      if (d.value === display) {
        return { found: true, difference: DisplayDifference.Exact };
      }

      if (sensitivity === DisplayCompareSensitivity.CaseInsensitive ||
          sensitivity === DisplayCompareSensitivity.Normalized) {
        if (d.value.toLowerCase() === lowerDisplay) {
          return { found: true, difference: DisplayDifference.Case };
        }
      }

      if (sensitivity === DisplayCompareSensitivity.Normalized) {
        if (this._normalize(d.value) === normalizedDisplay) {
          return { found: true, difference: DisplayDifference.Normalized };
        }
      }
    }

    return { found: false, difference: DisplayDifference.None };
  }

  /**
   * Check if designation matches base language
   * @private
   */
  _matchesBaseLang(designation, defaultLang) {
    if (!defaultLang) return true;
    if (!designation.language) return true;
    return designation.language.matchesForDisplay(defaultLang);
  }

  /**
   * Normalize a string for comparison (trim whitespace, collapse spaces)
   * @private
   */
  _normalize(str) {
    if (!str) return '';
    return str.trim().replace(/\s+/g, ' ').toLowerCase();
  }

  /**
   * Count displays available for the given languages
   * @param {Languages} languages - Languages to consider
   * @param {Language} defaultLang - Default language fallback
   * @param {boolean} activeOnly - Only count active designations
   * @returns {number}
   */
  displayCount(languages, defaultLang = null, activeOnly = true) {
    let count = 0;

    for (const d of this.designations) {
      if (activeOnly && !d.isActive) continue;
      if (!d.isUseADisplay() || !d.value) continue;

      // Check language match
      if (languages && languages.length > 0) {
        let langMatch = false;
        if (d.language) {
          langMatch = languagesHasMatch(languages, d.language);
        } else if (defaultLang || this.baseLang) {
          langMatch = true;
        }
        if (!langMatch) continue;
      }

      count++;
    }

    return count;
  }

  /**
   * Get allowed displays as a list (for error messages)
   * @param {Array<string>} output - Array to populate
   * @param {Languages} languages - Languages to consider
   * @param {Language} defaultLang - Default language fallback
   */
  allowedDisplays(output, languages = null, defaultLang = null) {
    const seen = new Set();

    for (const d of this.designations) {
      if (!d.isActive || !d.isUseADisplay() || !d.value) continue;
      if (seen.has(d.value)) continue;

      // Check language match
      if (languages && languages.length > 0) {
        let langMatch = false;
        if (d.language) {
          langMatch = languagesHasMatch(languages, d.language);
        } else if (defaultLang || this.baseLang) {
          langMatch = true;
        }
        if (!langMatch) continue;
      }

      seen.add(d.value);
      output.push(d.value);
    }
  }

  /**
   * Format displays for error messages
   * @param {Languages} languages - Languages to consider
   * @param {Language} defaultLang - Default language fallback
   * @param {boolean} activeOnly - Only include active designations
   * @returns {string} Formatted string of displays
   */
  present(languages = null, defaultLang = null, activeOnly = true) {
    const displays = [];
    this.allowedDisplays(displays, languages, defaultLang);

    if (displays.length === 0) {
      return '(none)';
    }

    if (displays.length === 1) {
      return `'${displays[0]}'`;
    }

    if (displays.length <= 5) {
      return displays.map(d => `'${d}'`).join(', ');
    }

    // Too many - truncate
    const shown = displays.slice(0, 5);
    return shown.map(d => `'${d}'`).join(', ') + `, ... (${displays.length - 5} more)`;
  }

  /**
   * Get the inactive status string for a display
   * @param {string} display - Display text to find
   * @returns {string} Status string or empty
   */
  inactiveStatus(display) {
    for (const d of this.designations) {
      if (d.value === display && !d.isActive) {
        return 'inactive';
      }
    }
    return '';
  }

  /**
   * Check if this collection has any displays for the given languages
   * @param {Languages} languages - Languages to check
   * @returns {boolean}
   */
  hasAnyDisplays(languages) {
    return this.displayCount(languages, null, true) > 0;
  }

  /**
   * Get all designations as an array (for iteration)
   * @returns {ConceptDesignation[]}
   */
  all() {
    return [...this.designations];
  }

  /**
   * Get count of all designations
   * @returns {number}
   */
  get count() {
    return this.designations.length;
  }

  /**
   * Iterator support
   */
  [Symbol.iterator]() {
    return this.designations[Symbol.iterator]();
  }
}

module.exports = {
  ConceptDesignation,
  ConceptDesignations,
  DisplayCompareSensitivity,
  DisplayDifference,
  DesignationUse,
  languagesHasMatch
};
