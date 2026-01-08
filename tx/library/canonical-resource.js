
/**
 * Base class for metadata resources to provide common interface
 */
class CanonicalResource {
  /**
   * The original JSON object (always stored in R5 format internally)
   * @type {Object}
   */
  jsonObj = null;

  /**
   * FHIR source version of the loaded Resource
   *
   * Note that the constructors of the sub-classes conver the actual format to R5
   * this is the source version, not the actual version
   *
   * @type {string}
   */
  fhirVersion = 'R5';

  /**
   * The source package the CodeSystem was loaded from
   * @type {String}
   */
  sourcePackage = null;

  constructor(jsonObj, fhirVersion = 'R5') {
    this.jsonObj = jsonObj;
    this.fhirVersion = fhirVersion;
  }

  get resourceType() {
    return this.jsonObj.resourceType;
  }

  get url() {
    return this.jsonObj.url;
  }

  get version() {
    return this.jsonObj.version;
  }

  get name() {
    return this.jsonObj.name;
  }

  get title() {
    return this.jsonObj.title;
  }

  get status() {
    return this.jsonObj.status;
  }


  get versionedUrl() {
    return this.version ? this.url+'|' + this.version : this.url;
  }

  get vurl() {
    return this.version ? this.url+'|' + this.version : this.url;
  }

  get fhirType() {
    return this.jsonObj.resourceType;
  }


  /**
   * Gets the FHIR version this CodeSystem was loaded from
   * @returns {string} FHIR version ('R3', 'R4', or 'R5')
   */
  getFHIRVersion() {
    return this.fhirVersion;
  }

  versionAlgorithm() {
    let c = this.jsonObj.versionAlgorithmCoding;
    if (c) {
      return c.code;
    }
    return this.jsonObj.versionAlgorithmString;
  }
}

module.exports = { CanonicalResource };
