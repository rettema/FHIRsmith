const {CanonicalResource} = require("./canonical-resource");
const {VersionUtilities} = require("../../library/version-utilities");

/**
 * Represents a FHIR CapabilityStatement resource with version conversion support
 * @class
 */
class CapabilityStatement extends CanonicalResource {

  /**
   * Creates a new CapabilityStatement instance
   * @param {Object} jsonObj - The JSON object containing CapabilityStatement data
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
   * @param {string} jsonString - JSON string representation of CapabilityStatement
   * @param {string} [version='R5'] - FHIR version ('R3', 'R4', or 'R5')
   * @returns {CapabilityStatement} New CapabilityStatement instance
   */
  static fromJSON(jsonString, version = 'R5') {
    return new CapabilityStatement(JSON.parse(jsonString), version);
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
   * Converts input CapabilityStatement to R5 format (modifies input object for performance)
   * @param {Object} jsonObj - The input CapabilityStatement object
   * @param {string} version - Source FHIR version
   * @returns {Object} The same object, potentially modified to R5 format
   * @private
   */
  _convertToR5(jsonObj, version) {
    if (version === 'R5') {
      return jsonObj; // Already R5, no conversion needed
    }

    if (version === 'R3') {
      // R3: resourceType was "CapabilityStatement" (same as R4/R5)
      // Convert identifier from single object to array if present
      if (jsonObj.identifier && !Array.isArray(jsonObj.identifier)) {
        jsonObj.identifier = [jsonObj.identifier];
      }
      return jsonObj;
    }

    if (version === 'R4') {
      // R4 to R5: No major structural changes needed
      return jsonObj;
    }

    throw new Error(`Unsupported FHIR version: ${version}`);
  }

  /**
   * Converts R5 CapabilityStatement to target version format (clones object first)
   * @param {Object} r5Obj - The R5 format CapabilityStatement object
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
   * Converts R5 CapabilityStatement to R4 format
   * @param {Object} r5Obj - Cloned R5 CapabilityStatement object
   * @returns {Object} R4 format CapabilityStatement
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

    return r5Obj;
  }

  /**
   * Converts R5 CapabilityStatement to R3 format
   * @param {Object} r5Obj - Cloned R5 CapabilityStatement object
   * @returns {Object} R3 format CapabilityStatement
   * @private
   */
  _convertR5ToR3(r5Obj) {
    // First apply R4 conversions
    const r4Obj = this._convertR5ToR4(r5Obj);

    // Convert identifier array back to single object
    if (r4Obj.identifier && Array.isArray(r4Obj.identifier)) {
      if (r4Obj.identifier.length > 0) {
        r4Obj.identifier = r4Obj.identifier[0];
      } else {
        delete r4Obj.identifier;
      }
    }

    // Convert valueCanonical to valueUri throughout the object
    this._convertCanonicalToUri(r5Obj);


    // Convert rest.operation.definition from canonical string to Reference object
    for (const rest of r4Obj.rest || []) {
      for (const operation of rest.operation || []) {
        if (typeof operation.definition === 'string') {
          operation.definition = {reference: operation.definition};
        }
        for (const resource of rest.resource || []) {
          delete resource.operation;
        }
      }
    }

    return r4Obj;
  }

  /**
   * Recursively converts valueCanonical to valueUri in an object
   * R3 doesn't have canonical type, so valueCanonical must become valueUri
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
   * Validates that this is a proper CapabilityStatement resource
   * @throws {Error} If validation fails
   */
  validate() {
    if (!this.jsonObj || typeof this.jsonObj !== 'object') {
      throw new Error('Invalid CapabilityStatement: expected object');
    }

    if (this.jsonObj.resourceType !== 'CapabilityStatement') {
      throw new Error(`Invalid CapabilityStatement: resourceType must be "CapabilityStatement", got "${this.jsonObj.resourceType}"`);
    }

    if (!this.jsonObj.status || typeof this.jsonObj.status !== 'string') {
      throw new Error('Invalid CapabilityStatement: status is required and must be a string');
    }

    const validStatuses = ['draft', 'active', 'retired', 'unknown'];
    if (!validStatuses.includes(this.jsonObj.status)) {
      throw new Error(`Invalid CapabilityStatement: status must be one of ${validStatuses.join(', ')}, got "${this.jsonObj.status}"`);
    }

    if (!this.jsonObj.kind || typeof this.jsonObj.kind !== 'string') {
      throw new Error('Invalid CapabilityStatement: kind is required and must be a string');
    }

    const validKinds = ['instance', 'capability', 'requirements'];
    if (!validKinds.includes(this.jsonObj.kind)) {
      throw new Error(`Invalid CapabilityStatement: kind must be one of ${validKinds.join(', ')}, got "${this.jsonObj.kind}"`);
    }

    if (!this.jsonObj.fhirVersion || typeof this.jsonObj.fhirVersion !== 'string') {
      throw new Error('Invalid CapabilityStatement: fhirVersion is required and must be a string');
    }

    if (!this.jsonObj.format || !Array.isArray(this.jsonObj.format)) {
      throw new Error('Invalid CapabilityStatement: format is required and must be an array');
    }
  }

  /**
   * Gets the software information
   * @returns {Object|undefined} Software information object
   */
  getSoftware() {
    return this.jsonObj.software;
  }

  /**
   * Gets the implementation information
   * @returns {Object|undefined} Implementation information object
   */
  getImplementation() {
    return this.jsonObj.implementation;
  }

  /**
   * Gets the rest capabilities
   * @returns {Object[]} Array of rest capability objects
   */
  getRest() {
    return this.jsonObj.rest || [];
  }

  /**
   * Gets supported formats
   * @returns {string[]} Array of supported mime types
   */
  getFormats() {
    return this.jsonObj.format || [];
  }

  /**
   * Gets the FHIR version this capability statement describes
   * @returns {string} FHIR version string
   */
  getDescribedFhirVersion() {
    return this.jsonObj.fhirVersion;
  }

  /**
   * Gets basic info about this capability statement
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
      fhirVersion: this.jsonObj.fhirVersion,
      formats: this.getFormats(),
      software: this.getSoftware()?.name,
      restModes: this.getRest().map(r => r.mode)
    };
  }
}

module.exports = { CapabilityStatement };