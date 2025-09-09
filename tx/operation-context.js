const assert = require("assert");
const {Languages} = require("../library/languages");
const {TooCostlyError, TerminologyError} = require("./errors");


class TimeTracker {
  constructor() {
    this.startTime = performance.now();
    this.steps = [];
  }

  step(note) {
    const elapsed = Math.round(performance.now() - this.startTime);
    this.steps.push(`${elapsed}ms ${note}`);
  }

  log() {
    return this.steps.join('\n');
  }

  link() {
    const newTracker = new TimeTracker();
    newTracker.startTime = this.startTime;
    newTracker.steps = [...this.steps];
    return newTracker;
  }
}

class OperationContext {
  constructor(langs, id = null, timeLimit = 30) {
    this.langs = this._ensureLanguages(langs);
    this.id = id || this._generateId();
    this.startTime = performance.now();
    this.contexts = [];
    this.timeLimit = timeLimit * 1000; // Convert to milliseconds
    this.timeTracker = new TimeTracker();
    this.logEntries = [];

    this.timeTracker.step('tx-op');
  }

  _ensureLanguages(param) {
    assert(typeof param === 'string' || param instanceof Languages, 'Parameter must be string or Languages object');
    return typeof param === 'string' ? Languages.fromAcceptLanguage(param) : param;
  }

  _generateId() {
    return 'op_' + Math.random().toString(36).substr(2, 9) + '_' + Date.now();
  }

  /**
   * Create a copy of this operation context
   * @returns {OperationContext}
   */
  copy() {
    const newContext = new OperationContext(this.langs, this.id, this.timeLimit / 1000);
    newContext.contexts = [...this.contexts];
    newContext.startTime = this.startTime;
    newContext.timeTracker = this.timeTracker.link();
    newContext.logEntries = [...this.logEntries];
    return newContext;
  }

  /**
   * Check if operation has exceeded time limit
   * @param {string} place - Location identifier for debugging
   * @returns {boolean} true if operation should be terminated
   */
  deadCheck(place = 'unknown') {
    const elapsed = performance.now() - this.startTime;

    if (elapsed > this.timeLimit) {
      const timeInSeconds = Math.round(this.timeLimit / 1000);
      this.log(`Operation took too long @ ${place} (${this.constructor.name})`);

      const error = new TooCostlyError(
        `Operation exceeded time limit of ${timeInSeconds} seconds at ${place}`
      );
      error.diagnostics = this.diagnostics();
      throw error;
    }

    return false;
  }

  /**
   * Track a context URL and detect circular references
   * @param {string} vurl - Value set URL to track
   */
  seeContext(vurl) {
    if (this.contexts.includes(vurl)) {
      const contextList = '[' + this.contexts.join(', ') + ']';
      throw new TerminologyError(
        `Circular reference detected for ${vurl} in contexts: ${contextList}`
      );
    }
    this.contexts.push(vurl);
  }

  /**
   * Clear all tracked contexts
   */
  clearContexts() {
    this.contexts = [];
  }

  /**
   * Add a log entry with timestamp
   * @param {string} note - Log message
   */
  log(note) {
    const elapsed = Math.round(performance.now() - this.startTime);
    const logEntry = `${elapsed}ms ${note}`;
    this.logEntries.push(logEntry);
    this.timeTracker.step(note);
  }

  /**
   * Add a note specific to a value set
   * @param {Object} vs - Value set object (should have vurl property)
   * @param {string} note - Note to add
   */
  addNote(vs, note) {
    const vurl = vs && vs.vurl ? vs.vurl : 'unknown-valueset';
    const elapsed = Math.round(performance.now() - this.startTime);
    const logEntry = `${elapsed}ms ${vurl}: ${note}`;
    this.logEntries.push(logEntry);
    this.timeTracker.step(`${vurl}: ${note}`);
  }

  /**
   * Get diagnostic information including timing and logs
   * @returns {string}
   */
  diagnostics() {
    return this.timeTracker.log();
  }

  /**
   * Get the request ID
   * @returns {string}
   */
  get reqId() {
    return this.id;
  }

  /**
   * @type {Languages} languages specified in request
   */
  langs;
}

/**
 * Version rule modes for expansion parameters
 */
const ExpansionParamsVersionRuleMode = {
  DEFAULT: 0,
  CHECK: 1,
  OVERRIDE: 2
};

/**
 * Operation parameters for terminology operations
 */
class OperationParameters {
  constructor(languageDefinitions) {
    this.languageDefinitions = languageDefinitions;
    this.versionRules = [];
    this.valueSetVersionRules = [];
    this.properties = [];
    this.designations = [];

    // Boolean flags
    this._activeOnly = false;
    this._excludeNested = false;
    this._generateNarrative = true; // Default to true like Pascal
    this._limitedExpansion = false;
    this._excludeNotForUI = false;
    this._excludePostCoordinated = false;
    this._includeDesignations = false;
    this._includeDefinition = false;
    this._membershipOnly = false;
    this._defaultToLatestVersion = false;
    this._incompleteOK = false;
    this._displayWarning = false;
    this._diagnostics = false;

    // Tracking which properties have been explicitly set
    this._hasActiveOnly = false;
    this._hasExcludeNested = false;
    this._hasGenerateNarrative = false;
    this._hasLimitedExpansion = false;
    this._hasExcludeNotForUI = false;
    this._hasExcludePostCoordinated = false;
    this._hasIncludeDesignations = false;
    this._hasIncludeDefinition = false;
    this._hasMembershipOnly = false;
    this._hasDefaultToLatestVersion = false;
    this._hasIncompleteOK = false;
    this._hasDisplayWarning = false;

    // Language lists
    this._httpLanguages = null;
    this._displayLanguages = null;

    this.uid = '';
  }

  /**
   * Create default operation parameters
   */
  static defaultProfile(languageDefinitions) {
    return new OperationParameters(languageDefinitions);
  }

  // Property getters and setters with has tracking
  get activeOnly() { return this._activeOnly; }
  set activeOnly(value) {
    this._activeOnly = value;
    this._hasActiveOnly = true;
  }

  get excludeNested() { return this._excludeNested; }
  set excludeNested(value) {
    this._excludeNested = value;
    this._hasExcludeNested = true;
  }

  get generateNarrative() { return this._generateNarrative; }
  set generateNarrative(value) {
    this._generateNarrative = value;
    this._hasGenerateNarrative = true;
  }

  get limitedExpansion() { return this._limitedExpansion; }
  set limitedExpansion(value) {
    this._limitedExpansion = value;
    this._hasLimitedExpansion = true;
  }

  get excludeNotForUI() { return this._excludeNotForUI; }
  set excludeNotForUI(value) {
    this._excludeNotForUI = value;
    this._hasExcludeNotForUI = true;
  }

  get excludePostCoordinated() { return this._excludePostCoordinated; }
  set excludePostCoordinated(value) {
    this._excludePostCoordinated = value;
    this._hasExcludePostCoordinated = true;
  }

  get includeDesignations() { return this._includeDesignations; }
  set includeDesignations(value) {
    this._includeDesignations = value;
    this._hasIncludeDesignations = true;
  }

  get includeDefinition() { return this._includeDefinition; }
  set includeDefinition(value) {
    this._includeDefinition = value;
    this._hasIncludeDefinition = true;
  }

  get membershipOnly() { return this._membershipOnly; }
  set membershipOnly(value) {
    this._membershipOnly = value;
    this._hasMembershipOnly = true;
  }

  get defaultToLatestVersion() { return this._defaultToLatestVersion; }
  set defaultToLatestVersion(value) {
    this._defaultToLatestVersion = value;
    this._hasDefaultToLatestVersion = true;
  }

  get incompleteOK() { return this._incompleteOK; }
  set incompleteOK(value) {
    this._incompleteOK = value;
    this._hasIncompleteOK = true;
  }

  get displayWarning() { return this._displayWarning; }
  set displayWarning(value) {
    this._displayWarning = value;
    this._hasDisplayWarning = true;
  }

  get diagnostics() { return this._diagnostics; }
  set diagnostics(value) { this._diagnostics = value; }

  get httpLanguages() { return this._httpLanguages; }
  set httpLanguages(value) { this._httpLanguages = value; }

  get displayLanguages() { return this._displayLanguages; }
  set displayLanguages(value) { this._displayLanguages = value; }

  // Has property getters
  get hasActiveOnly() { return this._hasActiveOnly; }
  get hasExcludeNested() { return this._hasExcludeNested; }
  get hasGenerateNarrative() { return this._hasGenerateNarrative; }
  get hasLimitedExpansion() { return this._hasLimitedExpansion; }
  get hasExcludeNotForUI() { return this._hasExcludeNotForUI; }
  get hasExcludePostCoordinated() { return this._hasExcludePostCoordinated; }
  get hasIncludeDesignations() { return this._hasIncludeDesignations; }
  get hasIncludeDefinition() { return this._hasIncludeDefinition; }
  get hasMembershipOnly() { return this._hasMembershipOnly; }
  get hasDefaultToLatestVersion() { return this._hasDefaultToLatestVersion; }
  get hasIncompleteOK() { return this._hasIncompleteOK; }
  get hasDisplayWarning() { return this._hasDisplayWarning; }
  get hasHttpLanguages() {
    return this._httpLanguages !== null && this._httpLanguages !== undefined;
  }
  get hasDisplayLanguages() {
    return this._displayLanguages !== null && this._displayLanguages !== undefined;
  }
  get hasDesignations() { return this.designations.length > 0; }

  /**
   * Add a version rule for system expansion
   */
  addVersionRule(system, version, mode = ExpansionParamsVersionRuleMode.DEFAULT) {
    this.versionRules.push({ system, version, mode });
  }

  /**
   * Get version for a specific system and mode
   */
  getVersionForRule(systemURI, mode) {
    const rule = this.versionRules.find(r => r.system === systemURI && r.mode === mode);
    return rule ? rule.version : '';
  }

  /**
   * Parse and add version rule from URL string (format: "system|version")
   */
  seeVersionRule(url, mode) {
    const parts = url.split('|');
    if (parts.length === 2) {
      this.addVersionRule(parts[0], parts[1], mode);
    } else {
      const modeNames = ['Default', 'Check', 'Override'];
      throw new TerminologyError(
        `Unable to understand ${modeNames[mode]} system version "${url}"`
      );
    }
  }

  /**
   * Get working languages (display languages if available, otherwise http languages)
   */
  get workingLanguages() {
    return this._displayLanguages || this._httpLanguages;
  }

  /**
   * Get language summary string
   */
  get langSummary() {
    if (this._displayLanguages) {
      return this._displayLanguages.toString();
    } else if (this._httpLanguages) {
      return this._httpLanguages.toString();
    } else {
      return '--';
    }
  }

  /**
   * Process a parameter (simplified version without TFHIRObject dependency)
   */
  seeParameter(name, value, overwrite = false) {
    if (value == null) return;

    const stringValue = typeof value === 'string' ? value :
      (value.primitiveValue || value.toString());

    if (name === 'displayLanguage' && (!this.hasHttpLanguages || overwrite)) {
      this.displayLanguages = Languages.fromAcceptLanguage(stringValue);
    }

    if (name === 'designation') {
      this.designations.push(stringValue);
    }
  }

  /**
   * Check if value set version rules exist
   */
  get hasValueSetVersionRules() {
    return this.valueSetVersionRules.length > 0;
  }

  /**
   * Get value set version rules (creates array if needed)
   */
  getValueSetVersionRules() {
    return this.valueSetVersionRules;
  }

  /**
   * Create a summary string of all parameters
   */
  summary() {
    const parts = [];

    const addIfPresent = (key, value) => {
      if (value && value !== '') {
        parts.push(`${key}=${value}`);
      }
    };

    const addIfTrue = (key, value) => {
      if (value) {
        parts.push(key);
      }
    };

    addIfPresent('uid', this.uid);
    addIfPresent('properties', this.properties.join(','));

    if (this._httpLanguages) {
      addIfPresent('http-lang', this._httpLanguages.toString());
    }
    if (this._displayLanguages) {
      addIfPresent('disp-lang', this._displayLanguages.toString());
    }
    if (this.designations.length > 0) {
      addIfPresent('designations', this.designations.join(','));
    }

    addIfTrue('active-only', this._activeOnly);
    addIfTrue('exclude-nested', this._excludeNested);
    addIfTrue('generate-narrative', this._generateNarrative);
    addIfTrue('limited-expansion', this._limitedExpansion);
    addIfTrue('for-ui', this._excludeNotForUI);
    addIfTrue('exclude-post-coordinated', this._excludePostCoordinated);
    addIfTrue('include-designations', this._includeDesignations);
    addIfTrue('include-definition', this._includeDefinition);
    addIfTrue('membership-only', this._membershipOnly);
    addIfTrue('default-to-latest', this._defaultToLatestVersion);
    addIfTrue('incomplete-ok', this._incompleteOK);
    addIfTrue('display-warning', this._displayWarning);

    return parts.join(', ');
  }

  /**
   * Get version rules summary
   */
  get verSummary() {
    const modeNames = ['Default', 'Check', 'Override'];
    return this.versionRules.map(rule =>
      `${rule.system}#${rule.version}/${modeNames[rule.mode]}`
    ).join(', ');
  }

  /**
   * Generate hash for caching purposes
   */
  hash() {
    const parts = [
      this.uid,
      this._membershipOnly ? '1' : '0',
      this.properties.join(','),
      this._activeOnly ? '1' : '0',
      this._incompleteOK ? '1' : '0',
      this._displayWarning ? '1' : '0',
      this._excludeNested ? '1' : '0',
      this._generateNarrative ? '1' : '0',
      this._limitedExpansion ? '1' : '0',
      this._excludeNotForUI ? '1' : '0',
      this._excludePostCoordinated ? '1' : '0',
      this._includeDesignations ? '1' : '0',
      this._includeDefinition ? '1' : '0',
      this._hasActiveOnly ? '1' : '0',
      this._hasExcludeNested ? '1' : '0',
      this._hasGenerateNarrative ? '1' : '0',
      this._hasLimitedExpansion ? '1' : '0',
      this._hasExcludeNotForUI ? '1' : '0',
      this._hasExcludePostCoordinated ? '1' : '0',
      this._hasIncludeDesignations ? '1' : '0',
      this._hasIncludeDefinition ? '1' : '0',
      this._hasDefaultToLatestVersion ? '1' : '0',
      this._hasIncompleteOK ? '1' : '0',
      this._hasDisplayWarning ? '1' : '0',
      this._hasMembershipOnly ? '1' : '0',
      this._defaultToLatestVersion ? '1' : '0'
    ];

    if (this.hasHttpLanguages) {
      parts.push(this._httpLanguages.toString());
    }
    if (this.hasDisplayLanguages) {
      parts.push('*' + this._displayLanguages.toString());
    }
    if (this.hasDesignations) {
      parts.push(this.designations.join(','));
    }

    // Add version rules
    parts.push(...this.versionRules.map(rule =>
      `${rule.system}#${rule.version}/${rule.mode}`
    ));

    const hashString = parts.join('|');

    // Simple hash function - convert to 32-bit integer
    let hash = 0;
    for (let i = 0; i < hashString.length; i++) {
      const char = hashString.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }

    return Math.abs(hash).toString();
  }

  /**
   * Create a copy of this parameters object
   */
  clone() {
    const copy = new OperationParameters(this.languageDefinitions);

    // Copy all properties
    copy.uid = this.uid;
    copy.properties = [...this.properties];
    copy.designations = [...this.designations];
    copy.versionRules = this.versionRules.map(rule => ({ ...rule }));
    copy.valueSetVersionRules = [...this.valueSetVersionRules];

    // Copy boolean flags and their has tracking
    copy._activeOnly = this._activeOnly;
    copy._excludeNested = this._excludeNested;
    copy._generateNarrative = this._generateNarrative;
    copy._limitedExpansion = this._limitedExpansion;
    copy._excludeNotForUI = this._excludeNotForUI;
    copy._excludePostCoordinated = this._excludePostCoordinated;
    copy._includeDesignations = this._includeDesignations;
    copy._includeDefinition = this._includeDefinition;
    copy._membershipOnly = this._membershipOnly;
    copy._defaultToLatestVersion = this._defaultToLatestVersion;
    copy._incompleteOK = this._incompleteOK;
    copy._displayWarning = this._displayWarning;
    copy._diagnostics = this._diagnostics;

    copy._hasActiveOnly = this._hasActiveOnly;
    copy._hasExcludeNested = this._hasExcludeNested;
    copy._hasGenerateNarrative = this._hasGenerateNarrative;
    copy._hasLimitedExpansion = this._hasLimitedExpansion;
    copy._hasExcludeNotForUI = this._hasExcludeNotForUI;
    copy._hasExcludePostCoordinated = this._hasExcludePostCoordinated;
    copy._hasIncludeDesignations = this._hasIncludeDesignations;
    copy._hasIncludeDefinition = this._hasIncludeDefinition;
    copy._hasMembershipOnly = this._hasMembershipOnly;
    copy._hasDefaultToLatestVersion = this._hasDefaultToLatestVersion;
    copy._hasIncompleteOK = this._hasIncompleteOK;
    copy._hasDisplayWarning = this._hasDisplayWarning;

    // Copy language objects (create new instances)
    if (this._httpLanguages) {
      copy._httpLanguages = Languages.fromAcceptLanguage(this._httpLanguages.toString());
    }
    if (this._displayLanguages) {
      copy._displayLanguages = Languages.fromAcceptLanguage(this._displayLanguages.toString());
    }

    return copy;
  }
}

module.exports = {
  OperationContext,
  OperationParameters,
  ExpansionParamsVersionRuleMode,
  TimeTracker
};