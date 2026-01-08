const assert = require("assert");
const inspector = require("inspector");
const crypto = require("crypto");
const {Languages} = require("../library/languages");
const {Issue} = require("./library/operation-outcome");

/**
 * Check if running under a debugger
 * @returns {boolean}
 */
function isDebugging() {
  // Check if inspector is connected
  if (inspector.url() !== undefined) {
    return true;
  }
  // Also check for debug flags in case inspector not yet attached
  return process.execArgv.some(arg =>
    arg.includes('--inspect') || arg.includes('--debug')
  );
}


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


/**
 * Thread-safe resource cache for tx-resource parameters
 * Stores resources by cache-id for reuse across requests
 */
class ResourceCache {
  constructor() {
    this.cache = new Map();
    this.locks = new Map(); // For thread-safety with async operations
  }

  /**
   * Get resources for a cache-id
   * @param {string} cacheId - The cache identifier
   * @returns {Array} Array of resources, or empty array if not found
   */
  get(cacheId) {
    const entry = this.cache.get(cacheId);
    if (entry) {
      entry.lastUsed = Date.now();
      return [...entry.resources]; // Return a copy
    }
    return [];
  }

  /**
   * Check if a cache-id exists
   * @param {string} cacheId - The cache identifier
   * @returns {boolean}
   */
  has(cacheId) {
    return this.cache.has(cacheId);
  }

  /**
   * Add resources to a cache-id (merges with existing)
   * @param {string} cacheId - The cache identifier
   * @param {Array} resources - Resources to add
   */
  add(cacheId, resources) {
    if (!resources || resources.length === 0) return;

    const entry = this.cache.get(cacheId) || { resources: [], lastUsed: Date.now() };

    // Merge resources, avoiding duplicates by url+version
    for (const resource of resources) {
      const key = this._resourceKey(resource);
      const existingIndex = entry.resources.findIndex(r => this._resourceKey(r) === key);
      if (existingIndex >= 0) {
        // Replace existing
        entry.resources[existingIndex] = resource;
      } else {
        entry.resources.push(resource);
      }
    }

    entry.lastUsed = Date.now();
    this.cache.set(cacheId, entry);
  }

  /**
   * Set resources for a cache-id (replaces existing)
   * @param {string} cacheId - The cache identifier
   * @param {Array} resources - Resources to set
   */
  set(cacheId, resources) {
    this.cache.set(cacheId, {
      resources: [...resources],
      lastUsed: Date.now()
    });
  }

  /**
   * Clear a specific cache-id
   * @param {string} cacheId - The cache identifier
   */
  clear(cacheId) {
    this.cache.delete(cacheId);
  }

  /**
   * Clear all cached entries
   */
  clearAll() {
    this.cache.clear();
  }

  /**
   * Remove entries older than maxAge milliseconds
   * @param {number} maxAge - Maximum age in milliseconds
   */
  prune(maxAge = 3600000) { // Default 1 hour
    const now = Date.now();
    for (const [cacheId, entry] of this.cache.entries()) {
      if (now - entry.lastUsed > maxAge) {
        this.cache.delete(cacheId);
      }
    }
  }

  /**
   * Get the number of cached entries
   * @returns {number}
   */
  size() {
    return this.cache.size;
  }

  /**
   * Generate a key for a resource based on url and version
   * @param {Object} resource - The resource
   * @returns {string}
   */
  _resourceKey(resource) {
    const url = resource.url || resource.id || '';
    const version = resource.version || '';
    const type = resource.resourceType || '';
    return `${type}|${url}|${version}`;
  }
}

/**
 * Cache for expanded ValueSets
 * Stores expansions keyed by hash of (valueSet, params, additionalResources)
 * Only caches expansions that took longer than the minimum cache time
 */
class ExpansionCache {
  /**
   * Minimum time (ms) an expansion must take before we cache it
   */
  static MIN_CACHE_TIME_MS = 2000;

  /**
   * Maximum age (ms) for cached entries before pruning
   */
  static MAX_AGE_MS = 3600000; // 1 hour

  constructor() {
    this.cache = new Map();
  }

  /**
   * Compute a hash key for an expansion request.
   * This must hash the actual content of resources, not just their identity,
   * because clients can submit variations on the same ValueSet/CodeSystem.
   *
   * @param {Object|ValueSet} valueSet - The ValueSet to expand (wrapper or JSON)
   * @param {Object} params - Parameters resource (tx-resource and valueSet params excluded)
   * @param {Array} additionalResources - Additional resources in scope (CodeSystem/ValueSet wrappers)
   * @returns {string} Hash key
   */
  computeKey(valueSet, params, additionalResources) {
    const keyParts = [];

    // ValueSet content - always hash the full JSON content
    // The ValueSet might be a wrapper class or raw JSON
    const vsJson = valueSet.jsonObj || valueSet;
    keyParts.push(`vs:${JSON.stringify(vsJson)}`);

    // Parameters - filter out tx-resource and valueSet params, sort for consistency
    if (params && params.parameter) {
      const filteredParams = params.parameter
        .filter(p => p.name !== 'tx-resource' && p.name !== 'valueSet' && p.name !== 'cache-id')
        .map(p => {
          // Normalize parameter to string representation
          const value = p.valueString || p.valueCode || p.valueUri ||
            p.valueBoolean?.toString() || p.valueInteger?.toString() ||
            JSON.stringify(p.valueCoding) || '';
          return `${p.name}=${value}`;
        })
        .sort();
      keyParts.push(`params:${filteredParams.join('&')}`);
    }

    // Additional resources - hash the full content of each resource
    // Resources are now CodeSystem/ValueSet wrappers, not raw JSON
    if (additionalResources && additionalResources.length > 0) {
      const resourceHashes = additionalResources
        .map(r => {
          // Get the JSON object from wrapper or use directly
          const json = r.jsonObj || r;
          // Create a content hash for this resource
          return crypto.createHash('sha256')
            .update(JSON.stringify(json))
            .digest('hex')
            .substring(0, 16); // Use first 16 chars for brevity
        })
        .sort();
      keyParts.push(`additional:${resourceHashes.join(',')}`);
    }

    // Create SHA256 hash of the combined key
    const keyString = keyParts.join('||');
    return crypto.createHash('sha256').update(keyString).digest('hex');
  }


  /**
   * Get a cached expansion
   * @param {string} key - Hash key from computeKey()
   * @returns {Object|null} Cached expanded ValueSet or null
   */
  get(key) {
    const entry = this.cache.get(key);
    if (entry) {
      entry.lastUsed = Date.now();
      entry.hitCount++;
      return entry.expansion;
    }
    return null;
  }

  /**
   * Check if a cached expansion exists
   * @param {string} key - Hash key
   * @returns {boolean}
   */
  has(key) {
    return this.cache.has(key);
  }

  /**
   * Store an expansion in the cache (only if duration exceeds minimum)
   * @param {string} key - Hash key from computeKey()
   * @param {Object} expansion - The expanded ValueSet
   * @param {number} durationMs - How long the expansion took
   * @returns {boolean} True if cached, false if duration too short
   */
  set(key, expansion, durationMs) {
    // Only cache if expansion took significant time
    if (durationMs < ExpansionCache.MIN_CACHE_TIME_MS) {
      return false;
    }

    this.cache.set(key, {
      expansion: expansion,
      createdAt: Date.now(),
      lastUsed: Date.now(),
      durationMs: durationMs,
      hitCount: 0
    });
    return true;
  }

  /**
   * Force-store an expansion regardless of duration (for testing)
   * @param {string} key - Hash key
   * @param {Object} expansion - The expanded ValueSet
   */
  forceSet(key, expansion) {
    this.cache.set(key, {
      expansion: expansion,
      createdAt: Date.now(),
      lastUsed: Date.now(),
      durationMs: 0,
      hitCount: 0
    });
  }

  /**
   * Clear a specific entry
   * @param {string} key - Hash key
   */
  clear(key) {
    this.cache.delete(key);
  }

  /**
   * Clear all cached entries
   */
  clearAll() {
    this.cache.clear();
  }

  /**
   * Remove entries older than maxAge
   * @param {number} maxAge - Maximum age in milliseconds
   */
  prune(maxAge = ExpansionCache.MAX_AGE_MS) {
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.lastUsed > maxAge) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Get cache statistics
   * @returns {Object} Stats object
   */
  stats() {
    let totalHits = 0;
    let totalDuration = 0;
    for (const entry of this.cache.values()) {
      totalHits += entry.hitCount;
      totalDuration += entry.durationMs;
    }
    return {
      size: this.cache.size,
      totalHits,
      totalDurationSaved: totalHits > 0 ? totalDuration * totalHits : 0
    };
  }
}


class OperationContext {
  constructor(langs, i18n = null, id = null, timeLimit = 30, resourceCache = null, expansionCache = null) {
    this.i18n = i18n;
    this.langs = this._ensureLanguages(langs);
    this.id = id || this._generateId();
    this.startTime = performance.now();
    this.contexts = [];
    this.timeLimit = timeLimit * 1000; // Convert to milliseconds
    this.timeTracker = new TimeTracker();
    this.logEntries = [];
    this.resourceCache = resourceCache;
    this.expansionCache = expansionCache;
    this.debugging = isDebugging();

    this.timeTracker.step('tx-op');
  }

  _ensureLanguages(param) {
    assert(typeof param === 'string' || param instanceof Languages, 'Parameter must be string or Languages object');
    return typeof param === 'string' ? Languages.fromAcceptLanguage(param, this.i18n.languageDefinitions, false) : param;
  }

  _generateId() {
    return 'op_' + Math.random().toString(36).substr(2, 9) + '_' + Date.now();
  }

  /**
   * Create a copy of this operation context
   * @returns {OperationContext}
   */
  copy() {
    const newContext = new OperationContext(
      this.langs, this.i18n, this.id, this.timeLimit / 1000,
      this.resourceCache, this.expansionCache
    );
    newContext.contexts = [...this.contexts];
    newContext.startTime = this.startTime;
    newContext.timeTracker = this.timeTracker.link();
    newContext.logEntries = [...this.logEntries];
    newContext.debugging = this.debugging;
    return newContext;
  }

  /**
   * Check if operation has exceeded time limit
   * Skipped when running under debugger
   * @param {string} place - Location identifier for debugging
   * @returns {boolean} true if operation should be terminated
   */
  deadCheck(place = 'unknown') {
    // Skip time limit checks when debugging
    if (this.debugging) {
      return false;
    }

    const elapsed = performance.now() - this.startTime;

    if (elapsed > this.timeLimit) {
      const timeInSeconds = Math.round(this.timeLimit / 1000);
      this.log(`Operation took too long @ ${place} (${this.constructor.name})`);

      const error = new Issue("error", "too-costly", null, `Operation exceeded time limit of ${timeInSeconds} seconds at ${place}`);
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
      throw new Issue("error", "processing", null, 'VALUESET_CIRCULAR_REFERENCE', this.i18n.formatMessage(this.langs, 'VALUESET_CIRCULAR_REFERENCE', [vurl, contextList]), null).handleAsOO(400);
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
   * Execute and time an async operation, logging if it exceeds threshold
   * @param {string} name - Operation name for logging
   * @param {Function} fn - Async function to execute
   * @param {number} warnThreshold - Log warning if operation exceeds this ms (default 50)
   * @returns {*} Result of the function
   */
  async timed(name, fn, warnThreshold = 50) {
    const start = performance.now();
    try {
      return await fn();
    } finally {
      const duration = performance.now() - start;
      if (duration > warnThreshold) {
        this.log(`SLOW: ${name} took ${Math.round(duration)}ms`);
      }
    }
  }

  /**
   * Get elapsed time since operation started
   * @returns {number} Elapsed time in milliseconds
   */
  elapsed() {
    return performance.now() - this.startTime;
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

module.exports = {
  OperationContext,
  ExpansionParamsVersionRuleMode,
  TimeTracker,
  ResourceCache,
  ExpansionCache,
  isDebugging
};