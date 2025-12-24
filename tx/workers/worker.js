const { TerminologyError } = require('../operation-context');
const { CodeSystem } = require('../library/codesystem');
const ValueSet = require('../library/valueset');
const {VersionUtilities} = require("../../library/version-utilities");

/**
 * Custom error for terminology setup issues
 */
class TerminologySetupError extends Error {
  constructor(message) {
    super(message);
    this.name = 'TerminologySetupError';
  }
}

/**
 * Abstract base class for terminology operations
 */
class TerminologyWorker {
  additionalResources = []; // Resources provided via tx-resource parameter or cache

  /**
   * @param {OperationContext} opContext - Operation context
   * @param {Logger} log - Provider for code systems and resources
   * @param {Provider} provider - Provider for code systems and resources
   * @param {LanguageDefinitions} languages - Language definitions
   * @param {I18nSupport} i18n - Internationalization support
   */
  constructor(opContext, log, provider, languages, i18n) {
    this.opContext = opContext;
    this.log = log;
    this.provider = provider;
    this.languages = languages;
    this.i18n = i18n;
    this.noCacheThisOne = false;
    this.params = null; // Will be set by subclasses
    this.requiredSupplements = [];
  }

  /**
   * Abstract method to get operation name
   * @returns {string} Operation name
   */
  opName() {
    return '??';
  }

  /**
   * Abstract method to get value set handle
   * @returns {ValueSet} Value set being processed
   */
  vsHandle() {
    throw new Error('vsHandle() must be implemented by subclass');
  }

  /**
   * Check if operation should be terminated due to time/cost limits
   * @param {string} place - Location identifier for debugging
   */
  deadCheck(place = 'unknown') {
    this.opContext.deadCheck(place);
  }

  /**
   * Add cost diagnostics to an error
   * @param {TooCostlyError} e - The error to enhance
   * @returns {TooCostlyError} Enhanced error
   */
  costDiags(e) {
    e.diagnostics = this.opContext.diagnostics();
    return e;
  }

  /**
   * Find a resource in additional resources by URL and version
   * @param {string} url - Resource URL
   * @param {string} version - Resource version (optional)
   * @param {string} resourceType - Expected resource type
   * @param {boolean} error - Whether to throw error if type mismatch
   * @returns {CodeSystem|ValueSet|null} Found resource or null
   */
  findInAdditionalResources(url, version = '', resourceType, error = true) {
    if (!this.additionalResources || this.additionalResources.length === 0) {
      return null;
    }

    const matches = [];

    for (const resource of this.additionalResources) {
      this.deadCheck('findInAdditionalResources');

      if (url && ((resource.url === url) || (resource.vurl === url)) &&
        (!version || version === resource.version)) {

        if (resource.resourceType !== resourceType) {
          if (error) {
            throw new Error(`Attempt to reference ${url} as a ${resourceType} when it's a ${resource.resourceType}`);
          } else {
            return null;
          }
        }
        matches.push(resource);
      }
    }

    if (matches.length === 0) {
      return null;
    } else {
      // Find the latest version
      let latest = 0;
      for (let i = 1; i < matches.length; i++) {
        if (VersionUtilities.isThisOrLater(matches[latest].version, matches[i].version)) {
          latest = i;
        }
      }
      return matches[latest];
    }
  }

  /**
   * Find and load a code system provider
   * @param {string} url - Code system URL
   * @param {string} version - Code system version (optional)
   * @param {OperationParameters} params - Operation parameters
   * @param {Array<string>} kinds - Allowed content modes
   * @param {boolean} nullOk - Whether null result is acceptable
   * @returns {CodeSystemProvider|null} Code system provider or null
   */
  async findCodeSystem(url, version = '', params, kinds = ['complete'], nullOk = false) {
    if (!url) {
      return null;
    }

    let codeSystemResource = null;
    let provider = null;
    const supplements = this.loadSupplements(url, version);

    // First check additional resources
    codeSystemResource = this.findInAdditionalResources(url, version, 'CodeSystem', !nullOk);

    if (codeSystemResource) {
      if (codeSystemResource.content === 'complete') {
        // Create provider from complete code system
        provider = await this.provider.createCodeSystemProvider(this.opContext, codeSystemResource, supplements);
      }
    }

    // If no provider from additional resources, try main provider
    if (!provider) {
      provider = await this.provider.getCodeSystemProvider(this.opContext, url, version, supplements);
    }

    // If still no provider but we have a code system with allowed content mode
    if (!provider && codeSystemResource && kinds.includes(codeSystemResource.content)) {
      provider = await this.provider.createCodeSystemProvider(this.opContext, codeSystemResource, supplements);
    }

    if (!provider && !nullOk) {
      if (!version) {
        throw new TerminologySetupError(`Unable to provide support for code system ${url}`);
      } else {
        const versions = await this.listVersions(url);
        if (versions.length === 0) {
          throw new TerminologySetupError(`Unable to provide support for code system ${url} version ${version}`);
        } else {
          throw new TerminologySetupError(`Unable to provide support for code system ${url} version ${version} (known versions = ${versions.join(', ')})`);
        }
      }
    }

    return provider;
  }

  /**
   * List available versions for a code system
   * @param {string} url - Code system URL
   * @returns {Array<string>} Available versions
   */
  async listVersions(url) {
    const versions = new Set();

    // Check additional resources
    if (this.additionalResources) {
      for (const resource of this.additionalResources) {
        this.deadCheck('listVersions-additional');
        if (resource.url === url && resource.version) {
          versions.add(resource.version);
        }
      }
    }

    // Check main provider
    const providerVersions = await this.provider.listCodeSystemVersions(url);
    for (const version of providerVersions) {
      this.deadCheck('listVersions-provider');
      versions.add(version);
    }

    return Array.from(versions).sort();
  }

  /**
   * Load supplements for a code system
   * @param {string} url - Code system URL
   * @param {string} version - Code system version
   * @returns {Array<CodeSystem>} Supplement code systems
   */
  loadSupplements(url, version = '') {
    const supplements = [];

    if (!this.additionalResources) {
      return supplements;
    }

    for (const resource of this.additionalResources) {
      this.deadCheck('loadSupplements');
      if (resource.resourceType === 'CodeSystem' && resource instanceof CodeSystem) {
        const cs = resource;
        // Check if this code system supplements the target URL
        const supplementsUrl = cs.jsonObj.supplements;

        if (!supplementsUrl) {
          continue;
        }

        // Handle exact URL match (no version specified in supplements)
        if (supplementsUrl === url) {
          // If we're looking for a specific version, only include if no version in supplements URL
          if (!version) {
            supplements.push(cs);
          }
          continue;
        }

        // Handle versioned URL (format: url|version)
        if (supplementsUrl.startsWith(`${url}|`)) {
          if (!version) {
            // No version specified in search, include all supplements for this URL
            supplements.push(cs);
          } else {
            // Version specified, check if it matches the tail of supplements URL
            const supplementsVersion = supplementsUrl.substring(`${url}|`.length);
            if (supplementsVersion === version) {
              supplements.push(cs);
            }
          }
        }
      }
    }

    return supplements;
  }

  /**
   * Check supplements for a code system provider
   * @param {CodeSystemProvider} cs - Code system provider
   * @param {Object} src - Source element (for extensions)
   */
  checkSupplements(cs, src) {
    // Check for required supplements in extensions
    if (src && src.getExtensions) {
      const supplementExtensions = src.getExtensions('http://hl7.org/fhir/StructureDefinition/valueset-supplement');
      for (const ext of supplementExtensions) {
        const supplementUrl = ext.valueString || ext.valueUri;
        if (supplementUrl && !cs.hasSupplement(this.opContext, supplementUrl)) {
          throw new TerminologyError(`ValueSet depends on supplement '${supplementUrl}' on ${cs.systemUri} that is not known`);
        }
      }
    }

    // Remove required supplements that are satisfied
    for (let i = this.requiredSupplements.length - 1; i >= 0; i--) {
      if (cs.hasSupplement(this.opContext, this.requiredSupplements[i])) {
        this.requiredSupplements.splice(i, 1);
      }
    }
  }

  /**
   * Find a ValueSet by URL and optional version
   * @param {string} url - ValueSet URL (may include |version)
   * @param {string} version - ValueSet version (optional, overrides URL version)
   * @returns {ValueSet|null} Found ValueSet or null
   */
  async findValueSet(url, version = '') {
    if (!url) {
      return null;
    }

    // Parse URL|version format
    let effectiveUrl = url;
    let effectiveVersion = version;

    if (!effectiveVersion && url.includes('|')) {
      const parts = url.split('|');
      effectiveUrl = parts[0];
      effectiveVersion = parts[1];
    }

    // First check additional resources
    const fromAdditional = this.findInAdditionalResources(effectiveUrl, effectiveVersion, 'ValueSet', false);
    if (fromAdditional) {
      return fromAdditional;
    }

    // Then try the provider
    if (this.provider && this.provider.findValueSet) {
      const vs = await this.provider.findValueSet(this.opContext, effectiveUrl, effectiveVersion);
      if (vs) {
        return vs;
      }
    }

    return null;
  }

  /**
   * Apply version pinning rules from parameters
   * @param {string} url - ValueSet URL
   * @returns {string} Potentially versioned URL
   */
  pinValueSet(url) {
    if (!url || !this.params) {
      return url;
    }

    // Check for system-version parameters that might pin this ValueSet
    // Format: system-version=url|version or valueset-version=url|version
    const vsVersions = this.params.getAll ? this.params.getAll('valueset-version') : [];

    for (const vsv of vsVersions) {
      if (vsv && vsv.startsWith(url + '|')) {
        return vsv; // Return the pinned version
      }
      if (vsv && vsv.includes('|')) {
        const parts = vsv.split('|');
        if (parts[0] === url) {
          return vsv;
        }
      }
    }

    return url;
  }

  /**
   * Build a canonical URL from system and version
   * @param {string} system - System URL
   * @param {string} version - Version (optional)
   * @returns {string} Canonical URL (system|version or just system)
   */
  canonical(system, version = '') {
    if (!system) return '';
    if (!version) return system;
    return `${system}|${version}`;
  }

  /**
   * Parse a canonical URL into system and version parts
   * @param {string} canonical - Canonical URL (may include |version)
   * @returns {{system: string, version: string}}
   */
  parseCanonical(canonical) {
    if (!canonical) {
      return { system: '', version: '' };
    }

    const pipeIndex = canonical.indexOf('|');
    if (pipeIndex < 0) {
      return { system: canonical, version: '' };
    }

    return {
      system: canonical.substring(0, pipeIndex),
      version: canonical.substring(pipeIndex + 1)
    };
  }

  // ========== Additional Resources Handling ==========

  /**
   * Set up additional resources from tx-resource parameters and cache
   * @param {Object} params - Parameters resource
   */
  setupAdditionalResources(params) {
    if (!params || !params.parameter) return;

    // Collect tx-resource parameters (resources provided inline)
    const txResources = [];
    for (const param of params.parameter) {
      this.deadCheck('setupAdditionalResources');
      if (param.name === 'tx-resource' && param.resource) {
        let res = this.wrapRawResource(param.resource);
        if (res) {
          txResources.push(res);
        }
      }
    }

    // Check for cache-id
    const cacheIdParam = this.findParameter(params, 'cache-id');
    const cacheId = cacheIdParam ? this.getParameterValue(cacheIdParam) : null;

    if (cacheId && this.opContext.resourceCache) {
      // Merge tx-resources with cached resources
      if (txResources.length > 0) {
        this.opContext.resourceCache.add(cacheId, txResources);
      }

      // Set additional resources to all resources for this cache-id
      this.additionalResources = this.opContext.resourceCache.get(cacheId);
    } else {
      // No cache-id, just use the tx-resources directly
      this.additionalResources = txResources;
    }
  }

  /**
   * Wrap a raw resource in its appropriate class wrapper
   * @param {Object} resource - Raw resource object
   * @returns {CodeSystem|ValueSet|null} Wrapped resource or null
   */
  wrapRawResource(resource) {
    if (resource.resourceType === 'CodeSystem') {
      return new CodeSystem(resource);
    }
    if (resource.resourceType === 'ValueSet') {
      return new ValueSet(resource);
    }
    return null;
  }

  // ========== Parameters Handling ==========

  /**
   * Convert query parameters to a Parameters resource
   * @param {Object} query - Query parameters
   * @returns {Object} Parameters resource
   */
  queryToParameters(query) {
    const params = {
      resourceType: 'Parameters',
      parameter: []
    };

    if (!query) return params;

    for (const [name, value] of Object.entries(query)) {
      if (Array.isArray(value)) {
        // Repeating parameter
        for (const v of value) {
          params.parameter.push({ name, valueString: v });
        }
      } else {
        params.parameter.push({ name, valueString: value });
      }
    }

    return params;
  }

  /**
   * Convert form body to a Parameters resource, merging with query params
   * @param {Object} body - Form body
   * @param {Object} query - Query parameters
   * @returns {Object} Parameters resource
   */
  formToParameters(body, query) {
    const params = {
      resourceType: 'Parameters',
      parameter: []
    };

    // Add query params first
    if (query) {
      for (const [name, value] of Object.entries(query)) {
        if (Array.isArray(value)) {
          for (const v of value) {
            params.parameter.push({ name, valueString: v });
          }
        } else {
          params.parameter.push({ name, valueString: value });
        }
      }
    }

    // Add/override with body params
    if (body) {
      for (const [name, value] of Object.entries(body)) {
        if (Array.isArray(value)) {
          for (const v of value) {
            params.parameter.push({ name, valueString: v });
          }
        } else {
          params.parameter.push({ name, valueString: value });
        }
      }
    }

    return params;
  }

  /**
   * Find a parameter in a Parameters resource
   * @param {Object} params - Parameters resource
   * @param {string} name - Parameter name
   * @returns {Object|null} Parameter object or null
   */
  findParameter(params, name) {
    if (!params || !params.parameter) return null;
    return params.parameter.find(p => p.name === name) || null;
  }

  /**
   * Get the value from a parameter (handles various value types)
   * @param {Object} param - Parameter object
   * @returns {*} Parameter value
   */
  getParameterValue(param) {
    if (!param) return null;

    // Check for resource
    if (param.resource) return param.resource;

    // Check for various value types
    const valueTypes = [
      'valueString', 'valueCode', 'valueUri', 'valueCanonical', 'valueUrl',
      'valueBoolean', 'valueInteger', 'valueDecimal',
      'valueDateTime', 'valueDate', 'valueTime',
      'valueCoding', 'valueCodeableConcept',
      'valueIdentifier', 'valueQuantity'
    ];

    for (const vt of valueTypes) {
      if (param[vt] !== undefined) {
        return param[vt];
      }
    }

    return null;
  }

  /**
   * Get a string parameter value
   * @param {Object} params - Parameters resource
   * @param {string} name - Parameter name
   * @returns {string|null} Parameter value or null
   */
  getStringParam(params, name) {
    const p = this.findParameter(params, name);
    if (!p) return null;
    return p.valueString || p.valueCode || p.valueUri || null;
  }

  /**
   * Get a resource parameter value
   * @param {Object} params - Parameters resource
   * @param {string} name - Parameter name
   * @returns {Object|null} Resource or null
   */
  getResourceParam(params, name) {
    const p = this.findParameter(params, name);
    return p?.resource || null;
  }

  /**
   * Get a Coding parameter value
   * @param {Object} params - Parameters resource
   * @param {string} name - Parameter name
   * @returns {Object|null} Coding or null
   */
  getCodingParam(params, name) {
    const p = this.findParameter(params, name);
    return p?.valueCoding || null;
  }

  /**
   * Get a CodeableConcept parameter value
   * @param {Object} params - Parameters resource
   * @param {string} name - Parameter name
   * @returns {Object|null} CodeableConcept or null
   */
  getCodeableConceptParam(params, name) {
    const p = this.findParameter(params, name);
    return p?.valueCodeableConcept || null;
  }

  /**
   * Render a coded value as string for debugging/logging
   * @param {string|Object} system - System URI or coding object
   * @param {string} version - Version (optional)
   * @param {string} code - Code (optional)
   * @param {string} display - Display (optional)
   * @returns {string} Rendered string
   */
  static renderCoded(system, version = '', code = '', display = '') {
    if (typeof system === 'object') {
      // Handle coding or codeable concept objects
      if (system.system !== undefined) {
        // Coding object
        return TerminologyWorker.renderCoded(system.system, system.version, system.code, system.display);
      } else if (system.codings) {
        // Codeable concept object
        const rendered = system.codings.map(c => TerminologyWorker.renderCoded(c)).join(', ');
        return `[${rendered}]`;
      }
    }

    let result = system;
    if (version) {
      result += `|${version}`;
    }
    if (code) {
      result += `#${code}`;
    }
    if (display) {
      result += ` ("${display}")`;
    }

    return result;
  }
}

/**
 * Code system information provider for lookup operations
 */
class CodeSystemInformationProvider extends TerminologyWorker {
  constructor(opContext, provider, additionalResources, languages, i18n) {
    super(opContext, provider, additionalResources, languages, i18n);
  }

  /**
   * Lookup a code in a code system
   * @param {Object} coding - Coding to lookup
   * @param {OperationParameters} profile - Operation parameters
   * @param {Array<string>} props - Requested properties
   * @param {Object} resp - Response object to populate
   */
  async lookupCode(coding, profile, props = [], resp) {
    const params = profile || this.createDefaultParams();
    params.defaultToLatestVersion = true;

    const provider = await this.findCodeSystem(
      coding.systemUri || coding.system,
      coding.version,
      profile,
      ['complete', 'fragment'],
      false
    );

    try {
      resp.name = provider.name();
      resp.systemUri = provider.systemUri;

      const version = provider.version;
      if (version) {
        resp.version = version;
      }

      const ctxt = provider.locate(this.opContext, coding.code);

      if (!ctxt) {
        throw new TerminologyError(
          `Unable to find code ${coding.code} in ${coding.systemUri || coding.system} version ${version}`
        );
      }

      try {
        // Helper function to check if property should be included
        const hasProp = (name, def = true) => {
          if (!props || props.length === 0) {
            return def;
          }
          return props.includes(name) || props.includes('*');
        };

        // Add abstract property
        if (hasProp('abstract', true) && provider.isAbstract(this.opContext, ctxt)) {
          const p = resp.addProperty('abstract');
          p.value = { valueBoolean: true };
        }

        // Add inactive property
        if (hasProp('inactive', true)) {
          const p = resp.addProperty('inactive');
          p.value = { valueBoolean: provider.isInactive(this.opContext, ctxt) };
        }

        // Add definition property
        if (hasProp('definition', true)) {
          const definition = provider.definition(this.opContext, ctxt);
          if (definition) {
            const p = resp.addProperty('definition');
            p.value = { valueString: definition };
          }
        }

        resp.code = coding.code;
        resp.display = provider.display(this.opContext, ctxt, this.opContext.langs);

        // Allow provider to extend lookup with additional properties
        if (provider.extendLookup) {
          provider.extendLookup(this.opContext, ctxt, this.opContext.langs, props, resp);
        }

      } finally {
        // Clean up context
        if (ctxt && ctxt.cleanup) {
          ctxt.cleanup();
        }
      }
    } finally {
      // Clean up provider
      if (provider && provider.cleanup) {
        provider.cleanup();
      }
    }
  }

  /**
   * Create default operation parameters
   * @returns {OperationParameters} Default parameters
   */
  createDefaultParams() {
    // This would create default parameters - implementation depends on your parameter structure
    return {
      defaultToLatestVersion: true
    };
  }
}

module.exports = {
  TerminologyWorker,
  CodeSystemInformationProvider,
  TerminologySetupError
};