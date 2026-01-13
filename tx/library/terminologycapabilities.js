const {CanonicalResource} = require("./canonical-resource");
const {VersionUtilities} = require("../../library/version-utilities");

/**
 * Represents a FHIR TerminologyCapabilities resource with version conversion support.
 * Note: TerminologyCapabilities was introduced in R4. For R3, it is represented as a
 * Parameters resource with a specific structure.
 * @class
 */
class TerminologyCapabilities extends CanonicalResource {

  /**
   * Creates a new TerminologyCapabilities instance
   * @param {Object} jsonObj - The JSON object containing TerminologyCapabilities data
   * @param {string} [fhirVersion='R5'] - FHIR version ('R3', 'R4', or 'R5')
   */
  constructor(jsonObj, fhirVersion = 'R5') {
    super(jsonObj, fhirVersion);
    // Convert to R5 format internally (modifies input for performance)
    this.jsonObj = this._convertToR5(jsonObj, fhirVersion);
    this.validate();
    this.id = this.jsonObj.id;
  }

  /**
   * Static factory method for convenience
   * @param {string} jsonString - JSON string representation of TerminologyCapabilities
   * @param {string} [version='R5'] - FHIR version ('R3', 'R4', or 'R5')
   * @returns {TerminologyCapabilities} New TerminologyCapabilities instance
   */
  static fromJSON(jsonString, version = 'R5') {
    return new TerminologyCapabilities(JSON.parse(jsonString), version);
  }

  /**
   * Returns JSON string representation
   * @param {string} [version='R5'] - Target FHIR version ('R3', 'R4', or 'R5')
   * @returns {string} JSON string
   */
  toJSONString(version = 'R5') {
    const outputObj = this._convertFromR5(this.jsonObj, version);
    return JSON.stringify(outputObj);
  }

  /**
   * Returns JSON object in target version format
   * @param {string} [version='R5'] - Target FHIR version ('R3', 'R4', or 'R5')
   * @returns {Object} JSON object
   */
  toJSON(version = 'R5') {
    return this._convertFromR5(this.jsonObj, version);
  }

  /**
   * Converts input TerminologyCapabilities to R5 format (modifies input object for performance)
   * @param {Object} jsonObj - The input TerminologyCapabilities object
   * @param {string} version - Source FHIR version
   * @returns {Object} The same object, potentially modified to R5 format
   * @private
   */
  _convertToR5(jsonObj, version) {
    if (version === 'R5') {
      return jsonObj; // Already R5, no conversion needed
    }

    if (version === 'R4') {
      // R4 to R5: No major structural changes needed for TerminologyCapabilities
      return jsonObj;
    }

    if (VersionUtilities.isR3Ver(version)) {
      // R3: TerminologyCapabilities doesn't exist - it's a Parameters resource
      // Convert from Parameters format to TerminologyCapabilities
      return this._convertParametersToR5(jsonObj);
    }

    throw new Error(`Unsupported FHIR version: ${version}`);
  }

  /**
   * Converts R3 Parameters format to R5 TerminologyCapabilities
   * @param {Object} params - The Parameters resource
   * @returns {Object} TerminologyCapabilities in R5 format
   * @private
   */
  _convertParametersToR5(params) {
    if (params.resourceType !== 'Parameters') {
      throw new Error('R3 TerminologyCapabilities must be a Parameters resource');
    }

    const result = {
      resourceType: 'TerminologyCapabilities',
      id: params.id,
      status: 'active', // Default, as Parameters doesn't carry this
      kind: 'instance', // Default for terminology server capabilities
      codeSystem: []
    };

    const parameters = params.parameter || [];
    let currentSystem = null;

    for (const param of parameters) {
      switch (param.name) {
        case 'url':
          result.url = param.valueUri;
          break;
        case 'version':
          if (currentSystem) {
            // This is a code system version
            if (param.valueCode) {
              currentSystem.version = currentSystem.version || [];
              currentSystem.version.push({ code: param.valueCode });
            }
            // Empty version parameter means no specific version
          } else {
            // This is the TerminologyCapabilities version
            result.version = param.valueCode || param.valueString;
          }
          break;
        case 'date':
          result.date = param.valueDateTime;
          break;
        case 'system':
          // Start a new code system
          currentSystem = { uri: param.valueUri };
          result.codeSystem.push(currentSystem);
          break;
        case 'expansion.parameter':
          result.expansion = result.expansion || { parameter: [] };
          result.expansion.parameter.push({ name: param.valueCode });
          break;
      }
    }

    return result;
  }

  /**
   * Converts R5 TerminologyCapabilities to target version format (clones object first)
   * @param {Object} r5Obj - The R5 format TerminologyCapabilities object
   * @param {string} targetVersion - Target FHIR version
   * @returns {Object} New object in target version format
   * @private
   */
  _convertFromR5(r5Obj, targetVersion) {
    if (VersionUtilities.isR5Ver(targetVersion)) {
      return r5Obj; // No conversion needed
    }

    // Clone the object to avoid modifying the original
    const cloned = JSON.parse(JSON.stringify(r5Obj));

    if (VersionUtilities.isR4Ver(targetVersion)) {
      return this._convertR5ToR4(cloned);
    } else if (VersionUtilities.isR3Ver(targetVersion)) {
      return this._convertR5ToR3(cloned);
    }

    throw new Error(`Unsupported target FHIR version: ${targetVersion}`);
  }

  /**
   * Converts R5 TerminologyCapabilities to R4 format
   * @param {Object} r5Obj - Cloned R5 TerminologyCapabilities object
   * @returns {Object} R4 format TerminologyCapabilities
   * @private
   */
  _convertR5ToR4(r5Obj) {
    // Remove R5-specific elements
    if (r5Obj.versionAlgorithmString) {
      delete r5Obj.versionAlgorithmString;
    }
    if (r5Obj.versionAlgorithmCoding) {
      delete r5Obj.versionAlgorithmCoding;
    }

    // Convert valueCanonical to valueUri throughout the object
    this._convertCanonicalToUri(r5Obj);

    return r5Obj;
  }

  /**
   * Converts R5 TerminologyCapabilities to R3 format (Parameters resource)
   * In R3, TerminologyCapabilities didn't exist - we represent it as a Parameters resource
   * @param {Object} r5Obj - Cloned R5 TerminologyCapabilities object
   * @returns {Object} R3 format Parameters resource
   * @private
   */
  _convertR5ToR3(r5Obj) {
    const params = {
      resourceType: 'Parameters',
      id: r5Obj.id,
      parameter: []
    };

    // Add url parameter
    if (r5Obj.url) {
      params.parameter.push({
        name: 'url',
        valueUri: r5Obj.url
      });
    }

    // Add version parameter
    if (r5Obj.version) {
      params.parameter.push({
        name: 'version',
        valueCode: r5Obj.version
      });
    }

    // Add date parameter
    if (r5Obj.date) {
      params.parameter.push({
        name: 'date',
        valueDateTime: r5Obj.date
      });
    }

    // Add code systems with their versions
    for (const codeSystem of r5Obj.codeSystem || []) {
      // Add system parameter
      params.parameter.push({
        name: 'system',
        valueUri: codeSystem.uri
      });

      // Add version parameter(s) for this code system
      if (codeSystem.version && codeSystem.version.length > 0) {
        for (const ver of codeSystem.version) {
          if (ver.code) {
            params.parameter.push({
              name: 'version',
              valueCode: ver.code
            });
          } else {
            // Empty version parameter when no specific version
            params.parameter.push({
              name: 'version'
            });
          }
        }
      } else {
        // No version specified for this code system
        params.parameter.push({
          name: 'version'
        });
      }
    }

    // Add expansion parameters
    if (r5Obj.expansion && r5Obj.expansion.parameter) {
      for (const expParam of r5Obj.expansion.parameter) {
        params.parameter.push({
          name: 'expansion.parameter',
          valueCode: expParam.name
        });
      }
    }

    return params;
  }

  /**
   * Recursively converts valueCanonical to valueUri in an object
   * R3/R4 doesn't have canonical type in the same way, so valueCanonical must become valueUri
   * @param {Object} obj - Object to convert
   * @private
   */
  _convertCanonicalToUri(obj) {
    if (!obj || typeof obj !== 'object') {
      return;
    }

    if (Array.isArray(obj)) {
      obj.forEach(item => this._convertCanonicalToUri(item));
      return;
    }

    // Convert valueCanonical to valueUri
    if (obj.valueCanonical !== undefined) {
      obj.valueUri = obj.valueCanonical;
      delete obj.valueCanonical;
    }

    // Recurse into all properties
    for (const key of Object.keys(obj)) {
      if (typeof obj[key] === 'object') {
        this._convertCanonicalToUri(obj[key]);
      }
    }
  }

  /**
   * Validates that this is a proper TerminologyCapabilities resource
   * @throws {Error} If validation fails
   */
  validate() {
    if (!this.jsonObj || typeof this.jsonObj !== 'object') {
      throw new Error('Invalid TerminologyCapabilities: expected object');
    }

    if (this.jsonObj.resourceType !== 'TerminologyCapabilities') {
      throw new Error(`Invalid TerminologyCapabilities: resourceType must be "TerminologyCapabilities", got "${this.jsonObj.resourceType}"`);
    }

    if (!this.jsonObj.status || typeof this.jsonObj.status !== 'string') {
      throw new Error('Invalid TerminologyCapabilities: status is required and must be a string');
    }

    const validStatuses = ['draft', 'active', 'retired', 'unknown'];
    if (!validStatuses.includes(this.jsonObj.status)) {
      throw new Error(`Invalid TerminologyCapabilities: status must be one of ${validStatuses.join(', ')}, got "${this.jsonObj.status}"`);
    }

    if (!this.jsonObj.kind || typeof this.jsonObj.kind !== 'string') {
      throw new Error('Invalid TerminologyCapabilities: kind is required and must be a string');
    }

    const validKinds = ['instance', 'capability', 'requirements'];
    if (!validKinds.includes(this.jsonObj.kind)) {
      throw new Error(`Invalid TerminologyCapabilities: kind must be one of ${validKinds.join(', ')}, got "${this.jsonObj.kind}"`);
    }
  }

  /**
   * Gets the code systems supported by this terminology server
   * @returns {Object[]} Array of code system capability objects
   */
  getCodeSystems() {
    return this.jsonObj.codeSystem || [];
  }

  /**
   * Gets the expansion capabilities
   * @returns {Object|undefined} Expansion capability object
   */
  getExpansion() {
    return this.jsonObj.expansion;
  }

  /**
   * Gets the validate-code capabilities
   * @returns {Object|undefined} ValidateCode capability object
   */
  getValidateCode() {
    return this.jsonObj.validateCode;
  }

  /**
   * Gets the translation capabilities
   * @returns {Object|undefined} Translation capability object
   */
  getTranslation() {
    return this.jsonObj.translation;
  }

  /**
   * Gets the closure capabilities
   * @returns {Object|undefined} Closure capability object
   */
  getClosure() {
    return this.jsonObj.closure;
  }

  /**
   * Gets the list of supported expansion parameters
   * @returns {string[]} Array of parameter names
   */
  getExpansionParameters() {
    const expansion = this.getExpansion();
    if (!expansion || !expansion.parameter) {
      return [];
    }
    return expansion.parameter.map(p => p.name);
  }

  /**
   * Checks if a specific code system is supported
   * @param {string} uri - The code system URI to check
   * @returns {boolean} True if the code system is supported
   */
  supportsCodeSystem(uri) {
    return this.getCodeSystems().some(cs => cs.uri === uri);
  }

  /**
   * Gets version information for a specific code system
   * @param {string} uri - The code system URI
   * @returns {Object[]|undefined} Array of version objects or undefined if not found
   */
  getCodeSystemVersions(uri) {
    const codeSystem = this.getCodeSystems().find(cs => cs.uri === uri);
    return codeSystem?.version;
  }

  /**
   * Gets basic info about this terminology capabilities statement
   * @returns {Object} Basic information object
   */
  getInfo() {
    return {
      resourceType: this.jsonObj.resourceType,
      url: this.jsonObj.url,
      version: this.jsonObj.version,
      name: this.jsonObj.name,
      title: this.jsonObj.title,
      status: this.jsonObj.status,
      kind: this.jsonObj.kind,
      date: this.jsonObj.date,
      codeSystemCount: this.getCodeSystems().length,
      expansionParameters: this.getExpansionParameters()
    };
  }
}

module.exports = { TerminologyCapabilities };