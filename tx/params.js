const {Languages} = require("../library/languages");
const {validate} = require("node-cron");
const {validateParameter, validateResource, strToBool, getValuePrimitive} = require("../library/utilities");

class VersionRule {
  system;
  version;
  mode;

  constructor(system, version, mode = null) {
    this.system = system;
    this.version = version;
    this.mode = mode;
  }
  asString() {
    return this.mode + ':' + this.system + '#' + this.version;
  }

  asParam() {
    switch (this.mode) {
      case 'default': return "system-version" + '=' + this.system + '|' + this.version;
      case 'override': return "force-system-version" + '=' + this.system + '|' + this.version;
      case 'check': return "check-system-version" + '=' + this.system + '|' + this.version;
      default: throw new Error("Unsupported mode '" + this.mode + "'");
    }
  }

}

class TxParameters {
  constructor(languages) {
    this.FVersionRules = [];
    this.FProperties = [];
    this.FDesignations = [];
    this.FLanguages = languages;
    this.FGenerateNarrative = true;

    this.FHTTPLanguages = null;
    this.FDisplayLanguages = null;
    this.FValueSetVersionRules = null;
    this.FUid = '';

    this.FActiveOnly = false;
    this.FExcludeNested = false;
    this.FLimitedExpansion = false;
    this.FExcludeNotForUI = false;
    this.FExcludePostCoordinated = false;
    this.FIncludeDesignations = false;
    this.FIncludeDefinition = false;
    this.FDefaultToLatestVersion = false;
    this.FIncompleteOK = false;
    this.FDisplayWarning = false;
    this.FMembershipOnly = false;
    this.FDiagnostics = false;

    this.FHasActiveOnly = false;
    this.FHasExcludeNested = false;
    this.FHasGenerateNarrative = false;
    this.FHasLimitedExpansion = false;
    this.FHasExcludeNotForUI = false;
    this.FHasExcludePostCoordinated = false;
    this.FHasIncludeDesignations = false;
    this.FHasIncludeDefinition = false;
    this.FHasDefaultToLatestVersion = false;
    this.FHasIncompleteOK = false;
    this.FHasDisplayWarning = false;
    this.FHasMembershipOnly = false;
  }

  readParams(params) {
    validateResource(params, "params", "Parameters");

    if (!params.parameter) {
      return;
    }

    for (let p of params.parameter) {
      switch (p.name) {
        // Version rules
        case 'system-version': {
          this.seeVersionRule(getValuePrimitive(p), 'default');
          break;
        }
        case 'check-system-version': {
          this.seeVersionRule(getValuePrimitive(p), 'check');
          break;
        }
        case 'force-system-version': {
          this.seeVersionRule(getValuePrimitive(p), 'override');
          break;
        }
        case 'default-valueset-version': {
          this.getValueSetVersionRules().push(getValuePrimitive(p));
          break;
        }

        case 'displayLanguage': {
          this.DisplayLanguages = Languages.fromAcceptLanguage(getValuePrimitive(p));
          break;
        }
        case 'designation': {
          this.designations.push(getValuePrimitive(p));
          break;
        }
        case 'property': {
          this.properties.push(getValuePrimitive(p));
          break;
        }
        case 'no-cache': {
          if (getValuePrimitive(p) === 'true') this.uid = crypto.randomUUID();
          break;
        }
        case '_incomplete':
        case 'limitedExpansion': {
          let value = getValuePrimitive(p);
          if (value) this.limitedExpansion = strToBool(value, false);
          break;
        }
        case 'includeDesignations': {
          let value = getValuePrimitive(p);
          if (value) this.includeDesignations = strToBool(value, false);
          break;
        }
        case 'includeDefinition': {
          let value = getValuePrimitive(p);
          if (value) this.includeDefinition = strToBool(value, false);
          break;
        }
        case 'activeOnly': {
          let value = getValuePrimitive(p);
          if (value) this.activeOnly = strToBool(value, false);
          break;
        }
        case 'excludeNested': {
          let value = getValuePrimitive(p);
          if (value) this.excludeNested = strToBool(value, false);
          break;
        }
        case 'excludeNotForUI': {
          let value = getValuePrimitive(p);
          if (value) this.excludeNotForUI = strToBool(value, false);
          break;
        }
        case 'excludePostCoordinated': {
          let value = getValuePrimitive(p);
          if (value) this.excludePostCoordinated = strToBool(value, false);
          break;
        }
        case 'default-to-latest-version': {
          let value = getValuePrimitive(p);
          if (value) this.defaultToLatestVersion = strToBool(value, false);
          break;
        }
        case 'incomplete-ok': {
          let value = getValuePrimitive(p);
          if (value) this.incompleteOK = strToBool(value, false);
          break;
        }
        case 'diagnostics': {
          let value = getValuePrimitive(p);
          if (value) this.diagnostics = strToBool(value, false);
          break;
        }
        case 'lenient-display-validation': {
          if (getValuePrimitive(p) == true) this.displayWarning = true;
          break;
        }
        case 'valueset-membership-only': {
          if (getValuePrimitive(p) == true) this.membershipOnly = true;
          break;
        }
        case 'profile' : {
          let obj = params.obj('profile');
          if (obj !== null && (obj.fhirType === 'Parameters' || obj.fhirType === 'ExpansionProfile')) {
            this.readParams(pp);
          }
        }
      }
    }

    if (!this.hasHTTPLanguages && this.hasParam(params, "__Content-Language")) {
      this.HTTPLanguages = Languages.fromAcceptLanguage(this.paramstr(params, "__Content-Language"));
    }
    if (!this.hasHTTPLanguages && this.hasParam(params, "__Accept-Language")) {
      this.HTTPLanguages = Languages.fromAcceptLanguage(this.paramstr(params, "__Accept-Language"));
    }
  }

  paramstr(params, name) {
    if (params.parameter) {
      for (let p of params.parameter) {
        if (p.name == name) {
          return getValuePrimitive(p);
        }
      }
    }
  }

  hasParam(params, name) {
    return params.parameter && params.parameter.find(p => p.name == name);
  }

  get HTTPLanguages() {
    return this.FHTTPLanguages;
  }

  set HTTPLanguages(value) {
    this.FHTTPLanguages = value;
  }

  get DisplayLanguages() {
    return this.FDisplayLanguages;
  }

  set DisplayLanguages(value) {
    this.FDisplayLanguages = value;
  }

  get hasHTTPLanguages() {
    return this.FHTTPLanguages !== null && this.FHTTPLanguages.source !== '';
  }

  get hasDisplayLanguages() {
    return this.FDisplayLanguages !== null && this.FDisplayLanguages.source !== '';
  }

  get hasDesignations() {
    return this.FDesignations.length > 0;
  }

  get activeOnly() {
    return this.FActiveOnly;
  }

  set activeOnly(value) {
    this.FActiveOnly = value;
    this.FHasActiveOnly = true;
  }

  get excludeNested() {
    return this.FExcludeNested;
  }

  set excludeNested(value) {
    this.FExcludeNested = value;
    this.FHasExcludeNested = true;
  }

  get generateNarrative() {
    return this.FGenerateNarrative;
  }

  set generateNarrative(value) {
    this.FGenerateNarrative = value;
    this.FHasGenerateNarrative = true;
  }

  get limitedExpansion() {
    return this.FLimitedExpansion;
  }

  set limitedExpansion(value) {
    this.FLimitedExpansion = value;
    this.FHasLimitedExpansion = true;
  }

  get excludeNotForUI() {
    return this.FExcludeNotForUI;
  }

  set excludeNotForUI(value) {
    this.FExcludeNotForUI = value;
    this.FHasExcludeNotForUI = true;
  }

  get excludePostCoordinated() {
    return this.FExcludePostCoordinated;
  }

  set excludePostCoordinated(value) {
    this.FExcludePostCoordinated = value;
    this.FHasExcludePostCoordinated = true;
  }

  get includeDesignations() {
    return this.FIncludeDesignations;
  }

  set includeDesignations(value) {
    this.FIncludeDesignations = value;
    this.FHasIncludeDesignations = true;
  }

  get includeDefinition() {
    return this.FIncludeDefinition;
  }

  set includeDefinition(value) {
    this.FIncludeDefinition = value;
    this.FHasIncludeDefinition = true;
  }

  get defaultToLatestVersion() {
    return this.FDefaultToLatestVersion;
  }

  set defaultToLatestVersion(value) {
    this.FDefaultToLatestVersion = value;
    this.FHasDefaultToLatestVersion = true;
  }

  get incompleteOK() {
    return this.FIncompleteOK;
  }

  set incompleteOK(value) {
    this.FIncompleteOK = value;
    this.FHasIncompleteOK = true;
  }

  get displayWarning() {
    return this.FDisplayWarning;
  }

  set displayWarning(value) {
    this.FDisplayWarning = value;
    this.FHasDisplayWarning = true;
  }

  get membershipOnly() {
    return this.FMembershipOnly;
  }

  set membershipOnly(value) {
    this.FMembershipOnly = value;
    this.FHasMembershipOnly = true;
  }

  get versionRules() {
    return this.FVersionRules;
  }

  get properties() {
    return this.FProperties;
  }

  get designations() {
    return this.FDesignations;
  }

  static defaultProfile(langDefs) {
    return new TxParameters(langDefs);
  }

  seeParameter(name, value, overwrite) {
    if (value !== null) {
      if (name === 'displayLanguage' && (!this.hasHTTPLanguages || overwrite)) {
        this.DisplayLanguages = Languages.fromAcceptLanguage(getValuePrimitive(value))
      }

      if (name === 'designation') {
        this.designations.push(getValuePrimitive(value));
      }
    }
  }

  getVersionForRule(systemURI, mode) {
    for (let rule of this.FVersionRules) {
      if (rule.system === systemURI && rule.mode === mode) {
        return rule.version;
      }
    }
    return '';
  }

  rulesForSystem(systemURI) {
    let result = [];
    for (let t of this.FVersionRules) {
      if (t.system === systemURI) {
        result.push(t);
      }
    }
    return result;
  }

  seeVersionRule(url, mode) {
    let sl = url.split('|');
    if (sl.length === 2) {
      this.versionRules.push(new VersionRule(sl[0], sl[1], mode));
    } else {
      throw new Error('Unable to understand ' + mode + ' system version "' + url + '"');
    }
  }

  workingLanguages() {
    if (this.FDisplayLanguages !== null) {
      return this.FDisplayLanguages;
    } else {
      return this.FHTTPLanguages;
    }
  }

  langSummary() {
    if (this.FDisplayLanguages !== null && this.FDisplayLanguages.source !== '') {
      return this.FDisplayLanguages.asString(false);
    } else if (this.FHTTPLanguages !== null && this.FHTTPLanguages.source !== '') {
      return this.FHTTPLanguages.asString(false);
    } else {
      return '--';
    }
  }

  summary() {
    let result = '';

    const commaAdd = (r, s) => {
      if (r === '') return s;
      return r + ', ' + s;
    };

    const b = (s, v) => {
      if (v) {
        result = commaAdd(result, s);
      }
    };

    const sv = (s, v) => {
      if (v !== '') {
        result = commaAdd(result, s + '=' + v);
      }
    };

    sv('uid', this.FUid);
    if (this.FProperties !== null) {
      sv('properties', this.FProperties.join(','));
    }
    if (this.FHTTPLanguages !== null) {
      sv('http-lang', this.FHTTPLanguages.asString(true));
    }
    if (this.FDisplayLanguages !== null) {
      sv('disp-lang', this.FDisplayLanguages.asString(true));
    }
    if (this.FDesignations !== null) {
      sv('designations', this.FDesignations.join(','));
    }
    b('active-only', this.FActiveOnly);
    b('exclude-nested', this.FExcludeNested);
    b('generate-narrative', this.FGenerateNarrative);
    b('limited-expansion', this.FLimitedExpansion);
    b('for-ui', this.FExcludeNotForUI);
    b('exclude-post-coordinated', this.FExcludePostCoordinated);
    b('include-designations', this.FIncludeDesignations);
    b('include-definition', this.FIncludeDefinition);
    b('membership-only', this.FMembershipOnly);
    b('default-to-latest', this.FDefaultToLatestVersion);
    b('incomplete-ok', this.FIncompleteOK);
    b('display-warning', this.FDisplayWarning);

    return result;
  }

  verSummary() {
    let result = '';
    for (let p of this.FVersionRules) {
      if (result === '') {
        result = p.asString();
      } else {
        result = result + ', ' + p.asString();
      }
    }
    return result;
  }

  hash() {
    const b = (v) => {
      return v ? '1|' : '0|';
    };

    let s = this.FUid + '|' + b(this.FMembershipOnly) + '|' + this.FProperties.join(',') + '|' +
      b(this.FActiveOnly) + b(this.FIncompleteOK) + b(this.FDisplayWarning) + b(this.FExcludeNested) + b(this.FGenerateNarrative) + b(this.FLimitedExpansion) + b(this.FExcludeNotForUI) + b(this.FExcludePostCoordinated) +
      b(this.FIncludeDesignations) + b(this.FIncludeDefinition) + b(this.FHasActiveOnly) + b(this.FHasExcludeNested) + b(this.FHasGenerateNarrative) +
      b(this.FHasLimitedExpansion) + b(this.FHasExcludeNotForUI) + b(this.FHasExcludePostCoordinated) + b(this.FHasIncludeDesignations) +
      b(this.FHasIncludeDefinition) + b(this.FHasDefaultToLatestVersion) + b(this.FHasIncompleteOK) + b(this.FHasDisplayWarning) + b(this.FHasExcludeNotForUI) + b(this.FHasMembershipOnly) + b(this.FDefaultToLatestVersion);

    if (this.hasHTTPLanguages) {
      s = s + this.FHTTPLanguages.asString(true) + '|';
    }
    if (this.hasDisplayLanguages) {
      s = s + '*' + this.FDisplayLanguages.asString(true) + '|';
    }
    if (this.hasDesignations) {
      s = s + this.FDesignations.join(',') + '|';
    }
    for (let t of this.FVersionRules) {
      s = s + t.asString() + '|';
    }
    return HashStringToCode32(s).toString();
  }

  hasValueSetVersionRules() {
    return this.FValueSetVersionRules !== null;
  }

  getValueSetVersionRules() {
    if (this.FValueSetVersionRules === null) {
      this.FValueSetVersionRules = [];
    }
    return this.FValueSetVersionRules;
  }

  link() {
    return this;
  }

  clone() {
    let result = new TFHIRTxOperationParams(null);
    result.assign(this);
    return result;
  }

  assign(other) {
    this.FLanguages = other.FLanguages;
    if (other.FVersionRules !== null) {
      this.FVersionRules = [...other.FVersionRules];
    }
    if (other.FValueSetVersionRules !== null) {
      this.FValueSetVersionRules = [...other.FValueSetVersionRules];
    }
    this.FActiveOnly = other.FActiveOnly;
    this.FExcludeNested = other.FExcludeNested;
    this.FGenerateNarrative = other.FGenerateNarrative;
    this.FLimitedExpansion = other.FLimitedExpansion;
    this.FExcludeNotForUI = other.FExcludeNotForUI;
    this.FExcludePostCoordinated = other.FExcludePostCoordinated;
    this.FIncludeDesignations = other.FIncludeDesignations;
    this.FIncludeDefinition = other.FIncludeDefinition;
    this.FUid = other.FUid;
    this.FMembershipOnly = other.FMembershipOnly;
    this.FDefaultToLatestVersion = other.FDefaultToLatestVersion;
    this.FIncompleteOK = other.FIncompleteOK;
    this.FDisplayWarning = other.FDisplayWarning;
    this.FDiagnostics = other.FDiagnostics;
    this.FHasActiveOnly = other.FHasActiveOnly;
    this.FHasExcludeNested = other.FHasExcludeNested;
    this.FHasGenerateNarrative = other.FHasGenerateNarrative;
    this.FHasLimitedExpansion = other.FHasLimitedExpansion;
    this.FHasExcludeNotForUI = other.FHasExcludeNotForUI;
    this.FHasExcludePostCoordinated = other.FHasExcludePostCoordinated;
    this.FHasIncludeDesignations = other.FHasIncludeDesignations;
    this.FHasIncludeDefinition = other.FHasIncludeDefinition;
    this.FHasDefaultToLatestVersion = other.FHasDefaultToLatestVersion;
    this.FHasIncompleteOK = other.FHasIncompleteOK;
    this.FHasMembershipOnly = other.FHasMembershipOnly;
    this.FHasDisplayWarning = other.FHasDisplayWarning;

    if (other.FProperties !== null) {
      this.FProperties = [...other.FProperties];
    }

    if (other.FDesignations !== null) {
      this.FDesignations = [...other.FDesignations];
    }

    if (other.FHTTPLanguages !== null) {
      this.FHTTPLanguages = other.FHTTPLanguages.clone();
    }
    if (other.FDisplayLanguages !== null) {
      this.FDisplayLanguages = other.FDisplayLanguages.clone();
    }
  }

}

module.exports = { TxParameters, VersionRule };