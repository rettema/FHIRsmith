const { CodeSystem } = require("./library/codesystem");
const {VersionUtilities} = require("../library/version-utilities");
const { FhirCodeSystemProvider} = require("./cs/cs-cs");
const {OperationContext, TerminologyError} = require("./operation-context");
const {validateParameter, validateOptionalParameter, validateArrayParameter} = require("../library/utilities");
const path = require("path");
const {PackageContentLoader} = require("../library/package-manager");
const {ListCodeSystemProvider} = require("./cs/cs-provider-list");
const {PackageValueSetProvider} = require("./vs/vs-package");

/**
 * This class holds what information is in context
 *
 * It is prepared for each operation, and carries 4 sets of information:
 *
 * - The special code system classes supported natively by the system
 * - A list of all the code system resources in scope
 * - a list of value set providers that can provide value set instances
 * - a list of concept map providers that can provide concept map instances
 *
 */
class Provider {
  /**
   * {Map<String, CodeSystemFactoryProvider>} A list of code system factories that contains all the preloaded native code systems
   */
  codeSystemFactories;

  /**
   * {Map<String, CodeSystem>} A list of preloaded FHIR code systems
   */
  codeSystems;

  /**
   * {List<AbstractValueSetProvider>} A list of value set providers that know how to provide value sets by request
   */
  valueSetProviders;

  baseUrl = null;
  cacheFolder = null;
  startTime = Date.now();
  startMemory = process.memoryUsage();
  lastTime = null;
  totalDownloaded = 0;

  /**
   * get a code system provider for a known code system
   *
   * @param {OperationContext} opContext - The code system resource
   * @param {String} system - The URL - might include a |version
   * @param {String} version - The version, if seperate from the system
   * @param {String[]} supplements - Applicable supplements
   * @returns {CodeSystemProvider} Provider instance
   */
  async getCodeSystemProvider(opContext, system, version, supplements) {
    validateParameter(opContext, "opContext", OperationContext);
    validateParameter(system, "system", String);
    validateArrayParameter(supplements, "supplements", CodeSystem);
    validateOptionalParameter(version, "version", String);

    if (system.includes("|")) {
      const url = system.substring(0, system.indexOf("|"));
      const v = system.substring(system.indexOf("|")+1);
      if (version == null || v === version) {
        version = v;
      } else {
        throw new TerminologyError(`Version inconsistent in ${system}: ${v} vs ${version}`);
      }
      system = url;
    } else if (version === '') {
      version = null;
    }
    const vurl = system+(version ? "|"+version : "");
    const vurlMM = VersionUtilities.isSemVer(version) ? system+"|"+VersionUtilities.getMajMin(version) : null;
    let factory = this.codeSystemFactories.get(vurl);
    if (factory == null && vurlMM) {
      factory = this.codeSystemFactories.get(vurlMM);
    }
    if (factory != null) {
      return factory.build(opContext, supplements);
    }
    let cs = this.codeSystems.get(vurl);
    if (cs == null && vurlMM) {
      cs = this.codeSystems.get(vurlMM);
    }
    if (cs != null) {
      return this.createCodeSystemProvider(opContext, cs, supplements);
    }
    return null;
  }

  /**
   * Create a code system provider from a CodeSystem resource
   * @param {OperationContext} opContext - The code system resource
   * @param {CodeSystem} codeSystem - The code system resource
   * @param {CodeSystem[]} supplements - The code system resource
   * @returns {CodeSystemProvider} Provider instance
   */
  async createCodeSystemProvider(opContext, codeSystem, supplements) {
    validateParameter(opContext, "opContext", OperationContext);
    validateParameter(codeSystem, "codeSystem", CodeSystem);
    validateArrayParameter(supplements, "supplements", CodeSystem);
    return new FhirCodeSystemProvider(opContext, codeSystem, supplements);
  }


  async loadNpm(packageManager, cacheFolder,  details, isDefault, mode) {
    const packagePath = await packageManager.fetch(details, null);
    if (mode === "fetch" || mode === "cs") {
      return;
    }
    const fullPackagePath = path.join(cacheFolder, packagePath);
    const contentLoader = new PackageContentLoader(fullPackagePath);
    await contentLoader.initialize();

    const resources = await contentLoader.getResourcesByType("CodeSystem");
    for (const resource of resources) {
      const cs = new CodeSystem(await contentLoader.loadFile(resource, contentLoader.fhirVersion()));
      this.codeSystems.set(cs.url, cs);
      this.codeSystems.set(cs.vurl, cs);
    }
    const vs = new PackageValueSetProvider(contentLoader);
    await vs.initialize();
    this.valueSetProviders.push(vs);
  }

  getCodeSystemById(opContext, id) {
    // Search through codeSystems map for matching id
    for (const [key, cs] of this.codeSystems) {
      if (opContext) opContext.deadCheck('getCodeSystemById');
      if (cs.jsonObj.id === id) {
        return cs;
      }
    }
    return undefined;
  }

  async getValueSetById(opContext, id) {
    for (const vp of this.valueSetProviders) {
      if (opContext) opContext.deadCheck('getValueSetById');
      let vs = await vp.fetchValueSetById(id);
      if (vs) {
        return vs;
      }
    }
    return null;
  }

  async findValueSet(opContext, url, version) {
    for (const vp of this.valueSetProviders) {
      if (opContext) opContext.deadCheck('findValueSet');
      let vs = await vp.fetchValueSet(url, version);
      if (vs) {
        return vs;
      }
    }
    return null;
  }

}

module.exports = { Provider };