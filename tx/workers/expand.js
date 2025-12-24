//
// Expand Worker - Handles ValueSet $expand operation
//
// GET /ValueSet/{id}/$expand
// GET /ValueSet/$expand?url=...&version=...
// POST /ValueSet/$expand (form body or Parameters with url)
// POST /ValueSet/$expand (body is ValueSet resource)
// POST /ValueSet/$expand (body is Parameters with valueSet parameter)
//

const { TerminologyWorker, TerminologySetupError } = require('./worker');
const { TerminologyError } = require('../operation-context');
const { ConceptDesignations, DesignationUse } = require('../library/concept-designations');
const {CodeSystem} = require("../library/codesystem");
const {ValueSetDatabase} = require("../vs/vs-database");

// Expansion limits (from Pascal constants)
const UPPER_LIMIT_NO_TEXT = 1000;
const UPPER_LIMIT_TEXT = 1000;
const INTERNAL_LIMIT = 10000;
const EXPANSION_DEAD_TIME_SECS = 30;

/**
 * Total status for expansion
 */
const TotalStatus = {
  Uninitialized: 'uninitialized',
  Set: 'set',
  Off: 'off'
};

/**
 * Wraps an already-expanded ValueSet for fast code lookups
 * Used when importing ValueSets during expansion
 */
class ImportedValueSet {
  /**
   * @param {Object} valueSet - Expanded ValueSet resource
   */
  constructor(valueSet) {
    this.valueSet = valueSet;
    this.url = valueSet.url || '';
    this.version = valueSet.version || '';

    /** @type {Map<string, Object>} Maps system|code -> contains entry */
    this.codeMap = new Map();

    /** @type {Set<string>} Set of systems in this ValueSet */
    this.systems = new Set();

    this._buildCodeMap();
  }

  /**
   * Build the code lookup map from the expansion
   * @private
   */
  _buildCodeMap() {
    if (!this.valueSet.expansion || !this.valueSet.expansion.contains) {
      return;
    }

    this._indexContains(this.valueSet.expansion.contains);
  }

  /**
   * Recursively index contains entries
   * @private
   */
  _indexContains(contains) {
    for (const entry of contains) {
      if (entry.system && entry.code) {
        const key = this._makeKey(entry.system, entry.code);
        this.codeMap.set(key, entry);
        this.systems.add(entry.system);
      }

      // Handle nested contains (hierarchy)
      if (entry.contains && entry.contains.length > 0) {
        this._indexContains(entry.contains);
      }
    }
  }

  /**
   * Make a lookup key from system and code
   * @private
   */
  _makeKey(system, code) {
    return `${system}\x00${code}`;
  }

  /**
   * Check if this ValueSet contains a specific code
   * @param {string} system - Code system URL
   * @param {string} code - Code value
   * @returns {boolean}
   */
  hasCode(system, code) {
    return this.codeMap.has(this._makeKey(system, code));
  }

  /**
   * Get a contains entry for a specific code
   * @param {string} system - Code system URL
   * @param {string} code - Code value
   * @returns {Object|null}
   */
  getCode(system, code) {
    return this.codeMap.get(this._makeKey(system, code)) || null;
  }

  /**
   * Check if this ValueSet contains any codes from a system
   * @param {string} system - Code system URL
   * @returns {boolean}
   */
  hasSystem(system) {
    return this.systems.has(system);
  }

  /**
   * Get total number of codes
   * @returns {number}
   */
  get count() {
    return this.codeMap.size;
  }

  /**
   * Iterate over all codes
   * @yields {{system: string, code: string, entry: Object}}
   */
  *codes() {
    for (const [key, entry] of this.codeMap) {
      yield {
        system: entry.system,
        code: entry.code,
        entry
      };
    }
  }
}

/**
 * Special filter context for ValueSet import optimization
 * When a ValueSet can be used as a filter instead of full expansion
 */
class ValueSetFilterContext {
  /**
   * @param {ImportedValueSet} importedVs - The imported ValueSet
   */
  constructor(importedVs) {
    this.importedVs = importedVs;
    this.type = 'valueset';
  }

  /**
   * Check if a code passes this filter
   * @param {string} system - Code system URL
   * @param {string} code - Code value
   * @returns {boolean}
   */
  passesFilter(system, code) {
    return this.importedVs.hasCode(system, code);
  }
}

/**
 * Special filter context for empty filter (nothing matches)
 */
class EmptyFilterContext {
  constructor() {
    this.type = 'empty';
  }

  passesFilter() {
    return false;
  }
}

/**
 * ValueSet expansion engine
 * Handles the core logic of expanding a ValueSet definition into a list of codes
 */
class ValueSetExpander {
  /**
   * @param {TerminologyWorker} worker - Parent worker for provider access
   * @param {Object} params - Expansion parameters
   */
  constructor(worker, params) {
    this.worker = worker;
    this.opContext = worker.opContext;
    this.log = worker.log;
    this.params = params;

    // Internal expansion state
    /** @type {Map<string, Object>} Maps key -> contains item for dedup */
    this.codeMap = new Map();

    /** @type {Object[]} Root-level items (for hierarchical expansion) */
    this.rootList = [];

    /** @type {Object[]} All items flattened (for output) */
    this.fullList = [];

    /** @type {Set<string>} Excluded codes (system|version#code format) */
    this.excluded = new Set();

    /** @type {Map<string, number>} Per-system count for limits (CPT etc) */
    this.csCounter = new Map();

    /** @type {Map<string, ImportedValueSet>} Cache of imported ValueSets */
    this.importedValueSets = new Map();

    // State flags
    this.hasExclusions = false;
    this.totalStatus = TotalStatus.Uninitialized;
    this.total = 0;

    // Limits from parameters
    this.limitCount = INTERNAL_LIMIT;
    this.offset = this._getParamInt('offset', 0);
    this.count = this._getParamInt('count', -1);
    this.filter = this._getParamString('filter', '');
    this.includeDesignations = this._getParamBool('includeDesignations', false);
    this.includeDefinition = this._getParamBool('includeDefinition', false);
    this.activeOnly = this._getParamBool('activeOnly', false);
    this.excludeNested = this._getParamBool('excludeNested', false);
    this.excludeNotForUI = this._getParamBool('excludeNotForUI', false);
    this.excludePostCoordinated = this._getParamBool('excludePostCoordinated', false);

    this.canBeHierarchy = !this.excludeNested;

    this.doingVersion = false;

    // Used systems/valueSets tracking
    this.usedSystems = new Map(); // url -> version
    this.usedValueSets = new Map(); // url -> version
  }

  /**
   * Get integer parameter value
   * @private
   */
  _getParamInt(name, defaultValue) {
    const p = this._findParam(name);
    if (!p) return defaultValue;
    const val = parseInt(p.valueInteger ?? p.valueString ?? defaultValue);
    return isNaN(val) ? defaultValue : val;
  }

  /**
   * Get string parameter value
   * @private
   */
  _getParamString(name, defaultValue) {
    const p = this._findParam(name);
    return p?.valueString ?? p?.valueCode ?? defaultValue;
  }

  /**
   * Get boolean parameter value
   * @private
   */
  _getParamBool(name, defaultValue) {
    const p = this._findParam(name);
    if (!p) return defaultValue;
    if (p.valueBoolean !== undefined) return p.valueBoolean;
    if (p.valueString !== undefined) return p.valueString === 'true';
    return defaultValue;
  }

  /**
   * Find a parameter by name
   * @private
   */
  _findParam(name) {
    if (!this.params?.parameter) return null;
    return this.params.parameter.find(p => p.name === name);
  }

  /**
   * Dead check wrapper
   * @private
   */
  deadCheck(place) {
    this.opContext.deadCheck(place);
  }

  /**
   * Make a map key for a code
   * @param {string} system - Code system URL
   * @param {string} code - Code value
   * @returns {string}
   */
  makeKey(system, code) {
    return `${system}\x00${code}`;
  }

  /**
   * Make an exclusion key
   * @param {string} system - Code system URL
   * @param {string} version - Code system version
   * @param {string} code - Code value
   * @returns {string}
   */
  makeExclusionKey(system, version, code) {
    return `${system}|${version || ''}#${code}`;
  }

  /**
   * Check if a code is excluded
   * @param {string} system - Code system URL
   * @param {string} version - Code system version
   * @param {string} code - Code value
   * @returns {boolean}
   */
  isExcluded(system, version, code) {
    // Check with version
    if (this.excluded.has(this.makeExclusionKey(system, version, code))) {
      return true;
    }
    // Check without version
    if (version && this.excluded.has(this.makeExclusionKey(system, '', code))) {
      return true;
    }
    return false;
  }

  /**
   * Add an exclusion
   * @param {string} system - Code system URL
   * @param {string} version - Code system version
   * @param {string} code - Code value
   */
  addExclusion(system, version, code) {
    this.excluded.add(this.makeExclusionKey(system, version, code));
    this.hasExclusions = true;
  }

  /**
   * Record a used code system
   * @param {string} system - Code system URL
   * @param {string} version - Code system version
   */
  recordUsedSystem(system, version) {
    if (!this.usedSystems.has(system) || version) {
      this.usedSystems.set(system, version || this.usedSystems.get(system) || '');
    }
  }

  /**
   * Record a used value set
   * @param {string} url - ValueSet URL
   * @param {string} version - ValueSet version
   */
  recordUsedValueSet(url, version) {
    if (!this.usedValueSets.has(url) || version) {
      this.usedValueSets.set(url, version || this.usedValueSets.get(url) || '');
    }
  }

  /**
   * Check expansion count limit for a code system
   * @param {CodeSystemProvider} cs - Code system provider
   * @returns {boolean} True if limit reached
   */
  checkSystemLimit(cs) {
    const limit = cs.expandLimitation();
    if (limit <= 0) return false;

    const key = cs.system();
    const current = this.csCounter.get(key) || 0;

    if (current >= limit) {
      return true;
    }

    this.csCounter.set(key, current + 1);
    return false;
  }

  /**
   * Main expansion entry point
   * @param {Object} valueSet - ValueSet resource to expand
   * @returns {Object} Expanded ValueSet resource
   */
  async expand(valueSet) {
    // Handle wrapped valueSet (from database)
    const vs = valueSet.jsonObj ? valueSet.jsonObj : valueSet;
    this.deadCheck('expand-start');

    // Process compose
    if (vs.compose) {
      await this.handleCompose(vs.compose, vs);
    }

    // Build the expansion output
    return this.buildExpansion(vs);
  }

  /**
   * Check and validate a source (include/exclude) before processing
   * @param {Object} cset - ConceptSet (include/exclude element)
   * @param {Object} valueSet - Source ValueSet
   * @param {Map<string, string>} systemVersions - Tracks system -> version mappings
   */
  async checkSource(cset, valueSet, systemVersions) {
    this.deadCheck('checkSource');

    // Check referenced valueSets can be expanded
    if (cset.valueSet && cset.valueSet.length > 0) {
      for (const vsUrl of cset.valueSet) {
        this.deadCheck('checkSource-valueSet');
        const pinnedUrl = this.worker.pinValueSet(vsUrl);
        const { system: url, version } = this.worker.parseCanonical(pinnedUrl);

        // Check that the valueSet exists
        const vs = await this.worker.findValueSet(url, version);
        if (!vs) {
          throw new TerminologyError(`Unable to find ValueSet ${pinnedUrl}`);
        }
      }
    }

    // Track if we're using multiple versions of the same system
    const system = cset.system;
    const version = cset.version || '';

    if (system) {
      if (systemVersions.has(system)) {
        const existingVersion = systemVersions.get(system);
        if (existingVersion !== version) {
          this.doingVersion = true;
        }
      } else {
        systemVersions.set(system, version);
      }

      // Check code system exists and is valid
      const cs = await this.worker.findCodeSystem(system, version, this.params, ['complete', 'fragment'], true);
      if (cs) {
        const contentMode = cs.contentMode();

        if (contentMode !== 'complete') {
          if (contentMode === 'not-present') {
            throw new TerminologyError(
              `The code system definition for ${system} has no content, so this expansion cannot be performed`
            );
          } else if (contentMode === 'supplement') {
            throw new TerminologyError(
              `The code system definition for ${system} defines a supplement, so this expansion cannot be performed`
            );
          } else {
            // Fragment or example - check if incomplete-ok
            const incompleteOk = this._getParamBool('incomplete-ok', false);
            if (!incompleteOk) {
              throw new TerminologyError(
                `The code system definition for ${system} is a ${contentMode}, so this expansion is not permitted unless the expansion parameter "incomplete-ok" has a value of "true"`
              );
            }
            // TODO: Would add to expansion parameters here
          }
        }

        // Check for too costly expansion (all codes, no filter)
        if (!cset.concept?.length && !cset.filter?.length) {
          if (!this.filter) {
            // Check if code system is not closed (grammar-based)
            if (cs.isNotClosed && cs.isNotClosed()) {
              const specialEnum = cs.specialEnumeration ? cs.specialEnumeration() : null;
              if (specialEnum) {
                throw new TerminologyError(
                  `The code System "${system}" has a grammar, and cannot be enumerated directly. If an incomplete expansion is requested, a limited enumeration will be returned`
                );
              } else {
                throw new TerminologyError(
                  `The code System "${system}" has a grammar, and cannot be enumerated directly`
                );
              }
            }

            // Check total count against limit
            const totalCount = cs.totalCount ? await cs.totalCount() : 0;
            const limitedExpansion = this._getParamBool('limitedExpansion', false);
            if (totalCount > this.limitCount && !limitedExpansion) {
              throw new TerminologyError(
                `ValueSet expansion too costly: code system ${system} has ${totalCount} codes (limit: ${this.limitCount})`
              );
            }
          }
        }
      }
    }
  }

  /**
   * Process the compose element
   * @param {Object} compose - ValueSet.compose element
   * @param {Object} valueSet - Source ValueSet for context
   */
  async handleCompose(compose, valueSet) {
    this.deadCheck('handleCompose');

    // Check for inactive handling
    const excludeInactive = compose.inactive === false || this.activeOnly;

    // First, process top-level imports (R2/R3 style)
    // In R4+, these are typically in include.valueSet, but older formats had imports
    if (valueSet.compose?.import) {
      for (const importUrl of valueSet.compose.import) {
        this.deadCheck('handleCompose-import');

        const pinnedUrl = this.worker.pinValueSet(importUrl);
        const { system: url, version } = this.worker.parseCanonical(pinnedUrl);

        const vs = await this.worker.findValueSet(url, version);
        if (!vs) {
          throw new TerminologyError(`Unable to find imported ValueSet ${pinnedUrl}`);
        }

        // Recursively expand and import
        const subExpander = new ValueSetExpander(this.worker, this.params);
        const expanded = await subExpander.expand(vs);

        const imported = new ImportedValueSet(expanded);
        this.recordUsedValueSet(url, version);

        await this.importValueSet(imported, excludeInactive);
      }
    }

    // Check all sources before processing
    const systemVersions = new Map();

    if (compose.include) {
      for (const cset of compose.include) {
        this.deadCheck('handleCompose-checkInclude');
        await this.checkSource(cset, valueSet, systemVersions);
      }
    }

    if (compose.exclude) {
      for (const cset of compose.exclude) {
        this.deadCheck('handleCompose-checkExclude');
        this.hasExclusions = true;
        await this.checkSource(cset, valueSet, systemVersions);
      }
    }

    // Process excludes first (they just mark codes)
    if (compose.exclude) {
      for (const cset of compose.exclude) {
        this.deadCheck('handleCompose-exclude');
        await this.excludeCodes(cset, valueSet, excludeInactive);
      }
    }

    // Process includes
    if (compose.include) {
      for (const cset of compose.include) {
        this.deadCheck('handleCompose-include');
        await this.includeCodes(cset, valueSet, excludeInactive);
      }
    }
  }

  /**
   * Process an include element
   * @param {Object} cset - ConceptSet (include element)
   * @param {Object} valueSet - Source ValueSet
   * @param {boolean} excludeInactive - Whether to exclude inactive codes
   */
  async includeCodes(cset, valueSet, excludeInactive) {
    this.deadCheck('includeCodes');

    const system = cset.system;
    const version = cset.version || '';

    // Handle valueSet imports first
    if (cset.valueSet && cset.valueSet.length > 0) {
      await this.handleValueSetImports(cset, valueSet, excludeInactive);
      return;
    }

    // Must have a system if no valueSet imports
    if (!system) {
      throw new TerminologyError('Include must have either system or valueSet');
    }

    // Get the code system provider
    const cs = await this.worker.findCodeSystem(system, version, this.params, ['complete', 'fragment'], false);
    if (!cs) {
      throw new TerminologySetupError(`Unable to find code system ${this.worker.canonical(system, version)}`);
    }

    this.recordUsedSystem(cs.system(), cs.version());

    // Check for required supplements
    this.worker.checkSupplements(cs, cset);

    if (cset.concept && cset.concept.length > 0) {
      // Enumerated concepts
      await this.includeEnumeratedConcepts(cs, cset, excludeInactive);
    } else if (cset.filter && cset.filter.length > 0) {
      // Filtered concepts
      await this.includeFilteredConcepts(cs, cset, excludeInactive);
    } else {
      // All concepts from system
      await this.includeAllConcepts(cs, cset, excludeInactive);
    }
  }

  /**
   * Handle valueSet imports in an include
   * @param {Object} cset - ConceptSet
   * @param {Object} valueSet - Source ValueSet
   * @param {boolean} excludeInactive - Whether to exclude inactive
   */
  async handleValueSetImports(cset, valueSet, excludeInactive) {
    this.deadCheck('handleValueSetImports');

    // If there's also a system, the valueSet acts as a filter
    if (cset.system) {
      // The valueSet import constrains which codes from the system are included
      await this.includeCodesWithValueSetFilter(cset, valueSet, excludeInactive);
      return;
    }

    // Pure valueSet import - expand and import all codes
    for (const vsUrl of cset.valueSet) {
      this.deadCheck('handleValueSetImports-loop');

      const pinnedUrl = this.worker.pinValueSet(vsUrl);
      const { system: url, version } = this.worker.parseCanonical(pinnedUrl);

      // Try to get from cache first
      let imported = this.importedValueSets.get(pinnedUrl);

      if (!imported) {
        // Find and expand the valueSet
        const vs = await this.worker.findValueSet(url, version);
        if (!vs) {
          throw new TerminologyError(`Unable to find imported ValueSet ${pinnedUrl}`);
        }

        // Recursively expand
        const subExpander = new ValueSetExpander(this.worker, this.params);
        const expanded = await subExpander.expand(vs);

        imported = new ImportedValueSet(expanded);
        this.importedValueSets.set(pinnedUrl, imported);
      }

      this.recordUsedValueSet(url, version);

      // Import all codes
      await this.importValueSet(imported, excludeInactive);
    }
  }

  /**
   * Import all codes from an expanded ValueSet
   * @param {ImportedValueSet} imported - Imported ValueSet
   * @param {boolean} excludeInactive - Whether to exclude inactive
   */
  async importValueSet(imported, excludeInactive) {
    for (const { system, code, entry } of imported.codes()) {
      this.deadCheck('importValueSet-code');

      if (this.isExcluded(system, entry.version || '', code)) {
        continue;
      }

      if (excludeInactive && entry.inactive) {
        continue;
      }

      await this.addContainsEntry(entry);
    }
  }

  /**
   * Include with ValueSet acting as filter
   * @param {Object} cset - ConceptSet
   * @param {Object} valueSet - Source ValueSet
   * @param {boolean} excludeInactive - Whether to exclude inactive
   */
  async includeCodesWithValueSetFilter(cset, valueSet, excludeInactive) {
    // Build the filter from imported ValueSets
    const filters = [];
    for (const vsUrl of cset.valueSet) {
      const pinnedUrl = this.worker.pinValueSet(vsUrl);
      const { system: url, version } = this.worker.parseCanonical(pinnedUrl);

      let imported = this.importedValueSets.get(pinnedUrl);
      if (!imported) {
        const vs = await this.worker.findValueSet(url, version);
        if (!vs) {
          throw new TerminologyError(`Unable to find imported ValueSet ${pinnedUrl}`);
        }

        const subExpander = new ValueSetExpander(this.worker, this.params);
        const expanded = await subExpander.expand(vs);

        imported = new ImportedValueSet(expanded);
        this.importedValueSets.set(pinnedUrl, imported);
      }

      this.recordUsedValueSet(url, version);
      filters.push(new ValueSetFilterContext(imported));
    }

    // Now process the include with the valueSet filter applied
    const system = cset.system;
    const version = cset.version || '';

    const cs = await this.worker.findCodeSystem(system, version, this.params, ['complete', 'fragment'], false);
    if (!cs) {
      throw new TerminologySetupError(`Unable to find code system ${this.worker.canonical(system, version)}`);
    }

    this.recordUsedSystem(cs.system(), cs.version());
    this.worker.checkSupplements(cs, cset);

    // Process with filter
    if (cset.concept && cset.concept.length > 0) {
      await this.includeEnumeratedConceptsFiltered(cs, cset, filters, excludeInactive);
    } else if (cset.filter && cset.filter.length > 0) {
      await this.includeFilteredConceptsFiltered(cs, cset, filters, excludeInactive);
    } else {
      await this.includeAllConceptsFiltered(cs, cset, filters, excludeInactive);
    }
  }

  /**
   * Include enumerated concepts from a code system
   * @param {CodeSystemProvider} cs - Code system provider
   * @param {Object} cset - ConceptSet
   * @param {boolean} excludeInactive - Whether to exclude inactive
   */
  async includeEnumeratedConcepts(cs, cset, excludeInactive) {
    for (const concept of cset.concept) {
      this.deadCheck('includeEnumeratedConcepts');

      const code = concept.code;
      const result = await cs.locate(code);

      if (!result.context) {
        // Code not found - should we warn or error?
        this.log.warn(`Code ${code} not found in ${cs.system()}: ${result.message}`);
        continue;
      }

      if (this.isExcluded(cs.system(), cs.version(), code)) {
        continue;
      }

      if (excludeInactive && await cs.isInactive(result.context)) {
        continue;
      }

      await this.addCodeFromProvider(cs, result.context, concept, cset);
    }
  }

  /**
   * Include enumerated concepts with ValueSet filter
   */
  async includeEnumeratedConceptsFiltered(cs, cset, filters, excludeInactive) {
    for (const concept of cset.concept) {
      this.deadCheck('includeEnumeratedConceptsFiltered');

      const code = concept.code;

      // Check filter
      if (!this.passesFilters(cs.system(), code, filters)) {
        continue;
      }

      const result = await cs.locate(code);
      if (!result.context) {
        continue;
      }

      if (this.isExcluded(cs.system(), cs.version(), code)) {
        continue;
      }

      if (excludeInactive && await cs.isInactive(result.context)) {
        continue;
      }

      await this.addCodeFromProvider(cs, result.context, concept, cset);
    }
  }

  /**
   * Check if a code passes all filters
   * @param {string} system - Code system URL
   * @param {string} code - Code value
   * @param {Array} filters - Filter contexts
   * @returns {boolean}
   */
  passesFilters(system, code, filters) {
    for (const filter of filters) {
      if (!filter.passesFilter(system, code)) {
        return false;
      }
    }
    return true;
  }

  /**
   * Include filtered concepts from a code system
   * @param {CodeSystemProvider} cs - Code system provider
   * @param {Object} cset - ConceptSet
   * @param {boolean} excludeInactive - Whether to exclude inactive
   */
  async includeFilteredConcepts(cs, cset, excludeInactive) {
    // Get the filter execution context
    const filterContext = await cs.getPrepContext(true);

    try {
      // Apply each filter
      for (const filter of cset.filter) {
        this.deadCheck('includeFilteredConcepts-filter');

        if (!await cs.doesFilter(filter.property, filter.op, filter.value)) {
          throw new TerminologyError(
            `Code system ${cs.system()} does not support filter ${filter.property} ${filter.op} ${filter.value}`
          );
        }

        await cs.filter(filterContext, filter.property, filter.op, filter.value);
      }

      // Execute filters and iterate results
      const filterSets = await cs.executeFilters(filterContext);

      for (const filterSet of filterSets) {
        while (await cs.filterMore(filterContext, filterSet)) {
          this.deadCheck('includeFilteredConcepts-iterate');

          const context = await cs.filterConcept(filterContext, filterSet);
          const code = await cs.code(context);

          if (this.isExcluded(cs.system(), cs.version(), code)) {
            continue;
          }

          if (excludeInactive && await cs.isInactive(context)) {
            continue;
          }

          if (this.checkSystemLimit(cs)) {
            break;
          }

          await this.addCodeFromProvider(cs, context, null, cset);
        }
      }
    } finally {
      await cs.filterFinish(filterContext);
    }
  }

  /**
   * Include filtered concepts with ValueSet filter
   */
  async includeFilteredConceptsFiltered(cs, cset, vsFilters, excludeInactive) {
    const filterContext = await cs.getPrepContext(true);

    try {
      for (const filter of cset.filter) {
        this.deadCheck('includeFilteredConceptsFiltered-filter');

        if (!await cs.doesFilter(filter.property, filter.op, filter.value)) {
          throw new TerminologyError(
            `Code system ${cs.system()} does not support filter ${filter.property} ${filter.op} ${filter.value}`
          );
        }

        await cs.filter(filterContext, filter.property, filter.op, filter.value);
      }

      const filterSets = await cs.executeFilters(filterContext);

      for (const filterSet of filterSets) {
        while (await cs.filterMore(filterContext, filterSet)) {
          this.deadCheck('includeFilteredConceptsFiltered-iterate');

          const context = await cs.filterConcept(filterContext, filterSet);
          const code = await cs.code(context);

          // Check ValueSet filter
          if (!this.passesFilters(cs.system(), code, vsFilters)) {
            continue;
          }

          if (this.isExcluded(cs.system(), cs.version(), code)) {
            continue;
          }

          if (excludeInactive && await cs.isInactive(context)) {
            continue;
          }

          if (this.checkSystemLimit(cs)) {
            break;
          }

          await this.addCodeFromProvider(cs, context, null, cset);
        }
      }
    } finally {
      await cs.filterFinish(filterContext);
    }
  }

  /**
   * Include all concepts from a code system
   * @param {CodeSystemProvider} cs - Code system provider
   * @param {Object} cset - ConceptSet
   * @param {boolean} excludeInactive - Whether to exclude inactive
   */
  async includeAllConcepts(cs, cset, excludeInactive) {
    // Check for special enumeration (e.g., UCUM)
    const specialEnum = cs.specialEnumeration();
    if (specialEnum) {
      await this.includeSpecialEnumeration(cs, cset, excludeInactive);
      return;
    }

    // Use iterator if available
    const iterator = await cs.iterator(null);
    if (iterator) {
      await this.includeViaIterator(cs, iterator, cset, excludeInactive);
      return;
    }

    // Fall back to filter with no constraints
    const filterContext = await cs.getPrepContext(true);
    try {
      const filterSets = await cs.executeFilters(filterContext);

      for (const filterSet of filterSets) {
        while (await cs.filterMore(filterContext, filterSet)) {
          this.deadCheck('includeAllConcepts-iterate');

          const context = await cs.filterConcept(filterContext, filterSet);
          const code = await cs.code(context);

          if (this.isExcluded(cs.system(), cs.version(), code)) {
            continue;
          }

          if (excludeInactive && await cs.isInactive(context)) {
            continue;
          }

          if (this.checkSystemLimit(cs)) {
            break;
          }

          await this.addCodeFromProvider(cs, context, null, cset);
        }
      }
    } finally {
      await cs.filterFinish(filterContext);
    }
  }

  /**
   * Include all concepts with ValueSet filter
   */
  async includeAllConceptsFiltered(cs, cset, vsFilters, excludeInactive) {
    const iterator = await cs.iterator(null);
    if (iterator) {
      await this.includeViaIteratorFiltered(cs, iterator, cset, vsFilters, excludeInactive);
      return;
    }

    const filterContext = await cs.getPrepContext(true);
    try {
      const filterSets = await cs.executeFilters(filterContext);

      for (const filterSet of filterSets) {
        while (await cs.filterMore(filterContext, filterSet)) {
          this.deadCheck('includeAllConceptsFiltered-iterate');

          const context = await cs.filterConcept(filterContext, filterSet);
          const code = await cs.code(context);

          if (!this.passesFilters(cs.system(), code, vsFilters)) {
            continue;
          }

          if (this.isExcluded(cs.system(), cs.version(), code)) {
            continue;
          }

          if (excludeInactive && await cs.isInactive(context)) {
            continue;
          }

          if (this.checkSystemLimit(cs)) {
            break;
          }

          await this.addCodeFromProvider(cs, context, null, cset);
        }
      }
    } finally {
      await cs.filterFinish(filterContext);
    }
  }

  /**
   * Include concepts via iterator
   */
  async includeViaIterator(cs, iterator, cset, excludeInactive) {
    let context = await cs.nextContext(iterator);
    while (context) {
      this.deadCheck('includeViaIterator');

      const code = await cs.code(context);

      if (!this.isExcluded(cs.system(), cs.version(), code)) {
        if (!excludeInactive || !await cs.isInactive(context)) {
          if (!this.checkSystemLimit(cs)) {
            await this.addCodeFromProvider(cs, context, null, cset);
          }
        }
      }

      context = await cs.nextContext(iterator);
    }
  }

  /**
   * Include concepts via iterator with filter
   */
  async includeViaIteratorFiltered(cs, iterator, cset, vsFilters, excludeInactive) {
    let context = await cs.nextContext(iterator);
    while (context) {
      this.deadCheck('includeViaIteratorFiltered');

      const code = await cs.code(context);

      if (this.passesFilters(cs.system(), code, vsFilters)) {
        if (!this.isExcluded(cs.system(), cs.version(), code)) {
          if (!excludeInactive || !await cs.isInactive(context)) {
            if (!this.checkSystemLimit(cs)) {
              await this.addCodeFromProvider(cs, context, null, cset);
            }
          }
        }
      }

      context = await cs.nextContext(iterator);
    }
  }

  /**
   * Include concepts from special enumeration
   */
  async includeSpecialEnumeration(cs, cset, excludeInactive) {
    const filterContext = await cs.getPrepContext(true);
    try {
      await cs.specialFilter(filterContext, false);
      const filterSets = await cs.executeFilters(filterContext);

      for (const filterSet of filterSets) {
        while (await cs.filterMore(filterContext, filterSet)) {
          this.deadCheck('includeSpecialEnumeration-iterate');

          const context = await cs.filterConcept(filterContext, filterSet);
          const code = await cs.code(context);

          if (this.isExcluded(cs.system(), cs.version(), code)) {
            continue;
          }

          if (excludeInactive && await cs.isInactive(context)) {
            continue;
          }

          await this.addCodeFromProvider(cs, context, null, cset);
        }
      }
    } finally {
      await cs.filterFinish(filterContext);
    }
  }

  /**
   * Process an exclude element
   * @param {Object} cset - ConceptSet (exclude element)
   * @param {Object} valueSet - Source ValueSet
   * @param {boolean} excludeInactive - Whether to exclude inactive codes
   */
  async excludeCodes(cset, valueSet, excludeInactive) {
    this.deadCheck('excludeCodes');

    const system = cset.system;
    const version = cset.version || '';

    // Handle valueSet excludes
    if (cset.valueSet && cset.valueSet.length > 0) {
      for (const vsUrl of cset.valueSet) {
        const pinnedUrl = this.worker.pinValueSet(vsUrl);
        const { system: url, version: vsVersion } = this.worker.parseCanonical(pinnedUrl);

        let imported = this.importedValueSets.get(pinnedUrl);
        if (!imported) {
          const vs = await this.worker.findValueSet(url, vsVersion);
          if (!vs) {
            throw new TerminologyError(`Unable to find excluded ValueSet ${pinnedUrl}`);
          }

          const subExpander = new ValueSetExpander(this.worker, this.params);
          const expanded = await subExpander.expand(vs);

          imported = new ImportedValueSet(expanded);
          this.importedValueSets.set(pinnedUrl, imported);
        }

        // Add all codes as exclusions
        for (const { system: sys, code, entry } of imported.codes()) {
          this.addExclusion(sys, entry.version || '', code);
        }
      }
      return;
    }

    // Must have a system
    if (!system) {
      throw new TerminologyError('Exclude must have either system or valueSet');
    }

    const cs = await this.worker.findCodeSystem(system, version, this.params, ['complete', 'fragment'], true);

    if (cset.concept && cset.concept.length > 0) {
      // Enumerated exclusions
      for (const concept of cset.concept) {
        this.addExclusion(system, version, concept.code);
      }
    } else if (cset.filter && cset.filter.length > 0 && cs) {
      // Filtered exclusions
      await this.excludeFilteredConcepts(cs, cset);
    } else if (cs) {
      // All concepts excluded (unusual but valid)
      throw new TerminologyError('Cannot exclude all codes from a code system');
    }
  }

  /**
   * Exclude filtered concepts
   */
  async excludeFilteredConcepts(cs, cset) {
    const filterContext = await cs.getPrepContext(true);

    try {
      for (const filter of cset.filter) {
        if (!await cs.doesFilter(filter.property, filter.op, filter.value)) {
          throw new TerminologyError(
            `Code system ${cs.system()} does not support filter ${filter.property} ${filter.op} ${filter.value}`
          );
        }
        await cs.filter(filterContext, filter.property, filter.op, filter.value);
      }

      const filterSets = await cs.executeFilters(filterContext);

      for (const filterSet of filterSets) {
        while (await cs.filterMore(filterContext, filterSet)) {
          this.deadCheck('excludeFilteredConcepts');

          const context = await cs.filterConcept(filterContext, filterSet);
          const code = await cs.code(context);

          this.addExclusion(cs.system(), cs.version(), code);
        }
      }
    } finally {
      await cs.filterFinish(filterContext);
    }
  }

  /**
   * Add a code from a CodeSystemProvider to the expansion
   * @param {CodeSystemProvider} cs - Code system provider
   * @param {Object} context - Provider context for the concept
   * @param {Object} sourceConcept - Original concept from compose (if enumerated)
   * @param {Object} cset - Source ConceptSet
   */
  async addCodeFromProvider(cs, context, sourceConcept, cset) {
    this.deadCheck('addCodeFromProvider');

    const code = await cs.code(context);
    const system = cs.system();
    const version = this.doingVersion ? cs.version() : null;

    // Check if already added
    const key = this.makeKey(system, code);
    if (this.codeMap.has(key)) {
      return; // Already present
    }

    // Check limit
    if (this.fullList.length >= this.limitCount) {
      this.totalStatus = TotalStatus.Off;
      return;
    }

    // Build the contains entry
    const entry = {
      system,
      code
    };

    if (version) {
      entry.version = version;
    }

    // Get display
    const display = await cs.display(context);
    if (display) {
      entry.display = display;
    } else if (sourceConcept && sourceConcept.display) {
      entry.display = sourceConcept.display;
    }

    // Check abstract
    if (await cs.isAbstract(context)) {
      entry.abstract = true;
    }

    // Check inactive
    if (await cs.isInactive(context)) {
      entry.inactive = true;
    }

    // Add designations if requested
    if (this.includeDesignations) {
      const designations = await cs.designations(context);
      if (designations && designations.length > 0) {
        entry.designation = designations.map(d => ({
          language: d.language,
          use: d.use,
          value: d.value
        }));
      }
    }

    await this.addContainsEntry(entry);
  }

  /**
   * Add a contains entry to the expansion
   * @param {Object} entry - Contains entry
   */
  async addContainsEntry(entry) {
    const key = this.makeKey(entry.system, entry.code);

    if (this.codeMap.has(key)) {
      return; // Already present
    }

    if (this.fullList.length >= this.limitCount) {
      this.totalStatus = TotalStatus.Off;
      return;
    }

    // Apply text filter if present
    if (this.filter && !this.matchesFilter(entry)) {
      return;
    }

    this.codeMap.set(key, entry);
    this.fullList.push(entry);
    this.rootList.push(entry);

    if (this.totalStatus === TotalStatus.Uninitialized) {
      this.total++;
    }
  }

  /**
   * Check if an entry matches the text filter
   * @param {Object} entry - Contains entry
   * @returns {boolean}
   */
  matchesFilter(entry) {
    if (!this.filter) return true;

    const filterLower = this.filter.toLowerCase();

    // Check code
    if (entry.code && entry.code.toLowerCase().includes(filterLower)) {
      return true;
    }

    // Check display
    if (entry.display && entry.display.toLowerCase().includes(filterLower)) {
      return true;
    }

    // Check designations
    if (entry.designation) {
      for (const d of entry.designation) {
        if (d.value && d.value.toLowerCase().includes(filterLower)) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Build the final expansion output
   * @param {Object} valueSet - Source ValueSet
   * @returns {Object} Expanded ValueSet
   */
  buildExpansion(valueSet) {
    // Apply offset and count
    let outputList = this.rootList;

    if (this.offset > 0) {
      outputList = outputList.slice(this.offset);
    }

    if (this.count >= 0 && outputList.length > this.count) {
      outputList = outputList.slice(0, this.count);
    }

    // Build expansion parameters
    const parameters = [];

    // Add filter parameter if present
    if (this.filter) {
      parameters.push({ name: 'filter', valueString: this.filter });
    }

    // Add limitedExpansion if set
    const limitedExpansion = this._getParamBool('limitedExpansion', false);
    if (limitedExpansion) {
      parameters.push({ name: 'limitedExpansion', valueBoolean: true });
    }

    // Add displayLanguage - from displayLanguage param or Accept-Language header
    const displayLanguage = this._getParamString('displayLanguage', null);
    if (displayLanguage) {
      parameters.push({ name: 'displayLanguage', valueCode: displayLanguage });
    } else if (this.opContext && this.opContext.langs) {
      const langStr = this.opContext.langs.asString ? this.opContext.langs.asString(false) : null;
      if (langStr) {
        parameters.push({ name: 'displayLanguage', valueCode: langStr });
      }
    }

    // Add designation parameters (can be multiple)
    if (this.params?.parameter) {
      for (const p of this.params.parameter) {
        if (p.name === 'designation') {
          const value = p.valueString || p.valueCode || p.valueUri;
          if (value) {
            parameters.push({ name: 'designation', valueString: value });
          }
        }
      }
    }

    // Add excludeNested if set
    if (this.excludeNested) {
      parameters.push({ name: 'excludeNested', valueBoolean: true });
    }

    // Add activeOnly if set
    if (this.activeOnly) {
      parameters.push({ name: 'activeOnly', valueBoolean: true });
    }

    // Add includeDesignations if set
    if (this.includeDesignations) {
      parameters.push({ name: 'includeDesignations', valueBoolean: true });
    }

    // Add excludeNotForUI if set
    if (this.excludeNotForUI) {
      parameters.push({ name: 'excludeNotForUI', valueBoolean: true });
    }

    // Add excludePostCoordinated if set
    if (this.excludePostCoordinated) {
      parameters.push({ name: 'excludePostCoordinated', valueBoolean: true });
    }

    // Add offset if specified (not just > 0, but if it was a parameter)
    if (this.offset >= 0 && this._findParam('offset')) {
      parameters.push({ name: 'offset', valueInteger: this.offset });
    }

    // Add count if specified
    if (this.count >= 0) {
      parameters.push({ name: 'count', valueInteger: this.count });
    }
    // Add used systems
    for (const [system, version] of this.usedSystems) {
      const param = { name: 'used-codesystem', valueUri: system };
      if (version) {
        param.valueUri = `${system}|${version}`;
      }
      parameters.push(param);
    }

    // Add used valueSets
    for (const [url, version] of this.usedValueSets) {
      const param = { name: 'used-valueset', valueUri: url };
      if (version) {
        param.valueUri = `${url}|${version}`;
      }
      parameters.push(param);
    }

    // Build the result
    const result = {
      resourceType: 'ValueSet',
      url: valueSet.url,
      version: valueSet.version,
      name: valueSet.name,
      title: valueSet.title,
      status: valueSet.status,
      experimental: valueSet.experimental,
      expansion: {
        identifier: `urn:uuid:${this._generateUuid()}`,
        timestamp: new Date().toISOString(),
        contains: outputList
      }
    };

    if (valueSet.id) {
      result.id = valueSet.id;
    }

    if (parameters.length > 0) {
      result.expansion.parameter = parameters;
    }

    // Add total if known
    if (this.totalStatus === TotalStatus.Uninitialized || this.totalStatus === TotalStatus.Set) {
      result.expansion.total = this.fullList.length;
    }

    // Add offset if used
    if (this.offset > 0) {
      result.expansion.offset = this.offset;
    }

    return result;
  }

  /**
   * Generate a UUID
   * @private
   */
  _generateUuid() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }
}

class ExpandWorker extends TerminologyWorker {
  /**
   * @param {OperationContext} opContext - Operation context
   * @param {Logger} log - Logger instance
   * @param {Provider} provider - Provider for code systems and resources
   * @param {LanguageDefinitions} languages - Language definitions
   * @param {I18nSupport} i18n - Internationalization support
   */
  constructor(opContext, log, provider, languages, i18n) {
    super(opContext, log, provider, languages, i18n);
  }

  /**
   * Get operation name
   * @returns {string}
   */
  opName() {
    return 'expand';
  }

  /**
   * Handle a type-level $expand request
   * GET/POST /ValueSet/$expand
   * @param {express.Request} req - Express request
   * @param {express.Response} res - Express response
   */
  async handle(req, res) {
    try {
      await this.handleTypeLevelExpand(req, res);
    } catch (error) {
      this.log.error(`Error in $expand: ${error.message}`);
      console.error('$expand error:', error); // Full stack trace to console for debugging
      const statusCode = error.statusCode || 500;
      const issueCode = error.issueCode || 'exception';
      return res.status(statusCode).json({
        resourceType: 'OperationOutcome',
        issue: [{
          severity: 'error',
          code: issueCode,
          diagnostics: error.message
        }]
      });
    }
  }

  /**
   * Handle an instance-level $expand request
   * GET/POST /ValueSet/{id}/$expand
   * @param {express.Request} req - Express request
   * @param {express.Response} res - Express response
   */
  async handleInstance(req, res) {
    try {
      await this.handleInstanceLevelExpand(req, res);
    } catch (error) {
      this.log.error(`Error in $expand: ${error.message}`);
      console.error('$expand error:', error); // Full stack trace to console for debugging
      const statusCode = error.statusCode || 500;
      const issueCode = error.issueCode || 'exception';
      return res.status(statusCode).json({
        resourceType: 'OperationOutcome',
        issue: [{
          severity: 'error',
          code: issueCode,
          diagnostics: error.message
        }]
      });
    }
  }

  /**
   * Handle type-level expand: /ValueSet/$expand
   * ValueSet identified by url, or provided directly in body
   */
  async handleTypeLevelExpand(req, res) {
    this.deadCheck('expand-type-level');

    // Determine how the request is structured
    let valueSet = null;
    let params = null;

    if (req.method === 'POST' && req.body) {
      if (req.body.resourceType === 'ValueSet') {
        // Body is directly a ValueSet resource
        valueSet = req.body;
        params = this.queryToParameters(req.query);

      } else if (req.body.resourceType === 'Parameters') {
        // Body is a Parameters resource
        params = req.body;

        // Check for valueSet parameter
        const valueSetParam = this.findParameter(params, 'valueSet');
        if (valueSetParam && valueSetParam.resource) {
          valueSet = valueSetParam.resource;
        }

      } else {
        // Assume form body - convert to Parameters
        params = this.formToParameters(req.body, req.query);
      }
    } else {
      // GET request - convert query to Parameters
      params = this.queryToParameters(req.query);
    }

    // Check for context parameter - not supported yet
    const contextParam = this.findParameter(params, 'context');
    if (contextParam) {
      return res.status(400).json(this.operationOutcome('error', 'not-supported',
        'The context parameter is not yet supported'));
    }

    // Handle tx-resource and cache-id parameters
    this.setupAdditionalResources(params);

    // If no valueSet yet, try to find by url
    if (!valueSet) {
      const urlParam = this.findParameter(params, 'url');
      const versionParam = this.findParameter(params, 'valueSetVersion');

      if (!urlParam) {
        return res.status(400).json(this.operationOutcome('error', 'invalid',
          'Must provide either a ValueSet resource or a url parameter'));
      }

      const url = this.getParameterValue(urlParam);
      const version = versionParam ? this.getParameterValue(versionParam) : null;

      valueSet = await this.findValueSet(url, version);

      if (!valueSet) {
        return res.status(404).json(this.operationOutcome('error', 'not-found',
          version ? `ValueSet not found: ${url} version ${version}` : `ValueSet not found: ${url}`));
      }
    }

    // Perform the expansion
    const result = await this.doExpand(valueSet, params);
    return res.json(result);
  }

  /**
   * Handle instance-level expand: /ValueSet/{id}/$expand
   * ValueSet identified by resource ID
   */
  async handleInstanceLevelExpand(req, res) {
    this.deadCheck('expand-instance-level');

    const { id } = req.params;

    // Find the ValueSet by ID
    const valueSet = await this.provider.getValueSetById(this.opContext, id);

    if (!valueSet) {
      return res.status(404).json(this.operationOutcome('error', 'not-found',
        `ValueSet/${id} not found`));
    }

    // Parse parameters
    let params;
    if (req.method === 'POST' && req.body) {
      if (req.body.resourceType === 'Parameters') {
        params = req.body;
      } else {
        // Form body
        params = this.formToParameters(req.body, req.query);
      }
    } else {
      params = this.queryToParameters(req.query);
    }

    // Check for context parameter - not supported yet
    const contextParam = this.findParameter(params, 'context');
    if (contextParam) {
      return res.status(400).json(this.operationOutcome('error', 'not-supported',
        'The context parameter is not yet supported'));
    }

    // Handle tx-resource and cache-id parameters
    this.setupAdditionalResources(params);

    // Perform the expansion
    const result = await this.doExpand(valueSet, params);
    return res.json(result);
  }

  // Note: setupAdditionalResources, queryToParameters, formToParameters,
  // findParameter, getParameterValue, and wrapRawResource are inherited
  // from TerminologyWorker base class

  /**
   * Perform the actual expansion operation
   * Uses expansion cache for expensive operations
   * @param {Object} valueSet - ValueSet resource to expand
   * @param {Object} params - Parameters resource with expansion options
   * @returns {Object} Expanded ValueSet resource
   */
  async doExpand(valueSet, params) {
    this.deadCheck('doExpand');

    const expansionCache = this.opContext.expansionCache;
    const debugging = this.opContext.debugging;

    // Compute cache key (only if caching is available and not debugging)
    let cacheKey = null;
    if (expansionCache && !debugging) {
      cacheKey = expansionCache.computeKey(valueSet, params, this.additionalResources);

      // Check for cached expansion
      const cached = expansionCache.get(cacheKey);
      if (cached) {
        this.log.debug('Using cached expansion');
        return cached;
      }
    }

    // Perform the actual expansion
    const startTime = performance.now();
    const result = await this.performExpansion(valueSet, params);
    const durationMs = performance.now() - startTime;

    // Cache if it took long enough (and not debugging)
    if (cacheKey && expansionCache && !debugging) {
      const wasCached = expansionCache.set(cacheKey, result, durationMs);
      if (wasCached) {
        this.log.debug(`Cached expansion (took ${Math.round(durationMs)}ms)`);
      }
    }

    return result;
  }

  /**
   * Perform the actual expansion logic
   * @param {Object} valueSet - ValueSet resource to expand
   * @param {Object} params - Parameters resource with expansion options
   * @returns {Object} Expanded ValueSet resource
   */
  async performExpansion(valueSet, params) {
    this.deadCheck('performExpansion');

    // Store params for worker methods
    this.params = params;

    // Create expander and run expansion
    const expander = new ValueSetExpander(this, params);
    return await expander.expand(valueSet);
  }

  /**
   * Generate a UUID
   * @returns {string} UUID
   */
  generateUuid() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  /**
   * Build an OperationOutcome
   * @param {string} severity - error, warning, information
   * @param {string} code - Issue code
   * @param {string} message - Diagnostic message
   * @returns {Object} OperationOutcome resource
   */
  operationOutcome(severity, code, message) {
    return {
      resourceType: 'OperationOutcome',
      issue: [{
        severity,
        code,
        diagnostics: message
      }]
    };
  }
}

module.exports = {
  ExpandWorker,
  ValueSetExpander,
  ImportedValueSet,
  ValueSetFilterContext,
  EmptyFilterContext,
  TotalStatus,
  UPPER_LIMIT_NO_TEXT,
  UPPER_LIMIT_TEXT,
  INTERNAL_LIMIT,
  EXPANSION_DEAD_TIME_SECS
};