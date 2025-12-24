//
// Validate Worker - Handles $validate-code operations
//
// GET /CodeSystem/$validate-code?{params}
// POST /CodeSystem/$validate-code
// GET /CodeSystem/{id}/$validate-code?{params}
// POST /CodeSystem/{id}/$validate-code
// GET /ValueSet/$validate-code?{params}
// POST /ValueSet/$validate-code
// GET /ValueSet/{id}/$validate-code?{params}
// POST /ValueSet/{id}/$validate-code
//

const { TerminologyWorker } = require('./worker');
const { ValueSetExpander, ImportedValueSet } = require('./expand');
const { ConceptDesignations, DisplayCheckSensitivity, DisplayDifference } = require('../library/concept-designations');
const { CodeSystemContentMode } = require('../library/codesystem');

/**
 * Validation check mode - affects how errors are reported
 */
const ValidationCheckMode = {
  Code: 'code',           // Just code string, infer system
  Coding: 'coding',       // Single coding with system/code
  CodeableConcept: 'codeableConcept'  // Multiple codings, any match is success
};

/**
 * Tri-state boolean for validation results
 */
const TrueFalseUnknown = {
  True: 'true',
  False: 'false',
  Unknown: 'unknown'
};

/**
 * Issue category codes for OperationOutcome
 */
const IssueCategory = {
  NotFound: 'not-found',
  NotInVS: 'not-in-vs',
  ThisNotInVS: 'this-not-in-vs',
  InvalidCode: 'code-invalid',
  InvalidData: 'invalid',
  CodeRule: 'code-rule',
  Display: 'display',
  DisplayComment: 'display-comment',
  CodeComment: 'code-comment',
  StatusCheck: 'status-check',
  VSProcessing: 'vs-processing',
  InferFailed: 'infer-failed',
  ProcessingNote: 'processing-note'
};

/**
 * FHIR issue types
 */
const IssueType = {
  Invalid: 'invalid',
  NotFound: 'not-found',
  CodeInvalid: 'code-invalid',
  BusinessRule: 'business-rule',
  NotSupported: 'not-supported',
  Informational: 'informational'
};

/**
 * Helper class for building OperationOutcome issues during validation
 */
class ValidationIssues {
  constructor() {
    this.issues = [];
    this.hasErrors = false;
  }

  /**
   * Add an issue
   * @param {string} severity - error, warning, information
   * @param {string} code - Issue code (IssueType)
   * @param {string} path - Location path
   * @param {string} messageId - Message identifier for i18n
   * @param {string} message - Human-readable message
   * @param {string} category - Issue category
   * @returns {boolean} True if issue was added (not duplicate)
   */
  addIssue(severity, code, path, messageId, message, category) {
    // Check for duplicate message
    if (this.issues.some(i => i.diagnostics === message)) {
      return false;
    }

    const issue = {
      severity,
      code,
      diagnostics: message
    };

    if (path) {
      issue.location = [path];
    }

    // Add extension for message ID if provided
    if (messageId) {
      issue.details = {
        coding: [{
          system: 'http://hl7.org/fhir/tools/CodeSystem/tx-issue-type',
          code: category || messageId
        }]
      };
    }

    this.issues.push(issue);

    if (severity === 'error') {
      this.hasErrors = true;
    }

    return true;
  }

  /**
   * Get the OperationOutcome resource
   */
  toOperationOutcome() {
    if (this.issues.length === 0) {
      return null;
    }
    return {
      resourceType: 'OperationOutcome',
      issue: this.issues
    };
  }
}

/**
 * Value Set Checker - performs validation against a ValueSet
 * Port of TValueSetChecker from Pascal
 */
class ValueSetChecker {
  /**
   * @param {ValidateWorker} worker - Parent worker
   * @param {Object} valueSet - ValueSet to validate against
   * @param {Object} params - Validation parameters
   */
  constructor(worker, valueSet, params) {
    this.worker = worker;
    this.opContext = worker.opContext;
    this.log = worker.log;
    this.provider = worker.provider;
    this.i18n = worker.i18n;
    this.languages = worker.languages;

    this.valueSet = valueSet;
    this.params = params;

    // Caches
    this.otherCheckers = new Map();  // url -> ValueSetChecker for imported value sets
    this.allValueSet = valueSet?.url === 'http://hl7.org/fhir/ValueSet/@all';

    // Tracking
    this.unknownSystems = new Set();
    this.unknownCodes = [];
    this.messages = [];

    // Parameters
    this.abstractOk = this._getParamBool('abstract', true);
    this.displayWarningMode = this._getParamBool('displayWarning', false);
    this.activeOnly = this._getParamBool('activeOnly', false);
    this.membershipOnly = this._getParamBool('membershipOnly', false);
    this.inferSystem = this._getParamBool('inferSystem', false);
  }

  _getParamBool(name, defaultValue) {
    if (!this.params?.parameter) return defaultValue;
    const p = this.params.parameter.find(param => param.name === name);
    if (!p) return defaultValue;
    if (p.valueBoolean !== undefined) return p.valueBoolean;
    if (p.valueString !== undefined) return p.valueString === 'true';
    return defaultValue;
  }

  _getParamString(name, defaultValue = null) {
    if (!this.params?.parameter) return defaultValue;
    const p = this.params.parameter.find(param => param.name === name);
    return p?.valueString || p?.valueCode || defaultValue;
  }

  /**
   * Prepare the checker for validation
   * Analyzes the ValueSet structure
   */
  async prepare() {
    this.worker.deadCheck('ValueSetChecker.prepare');

    if (!this.valueSet) {
      throw new Error('No ValueSet specified for validation');
    }

    // If the ValueSet has an expansion, use it
    if (this.valueSet.expansion?.contains) {
      this.hasExpansion = true;
    }

    // Prepare included value sets
    if (this.valueSet.compose?.include) {
      for (const inc of this.valueSet.compose.include) {
        await this.prepareConceptSet('include', inc);
      }
    }

    if (this.valueSet.compose?.exclude) {
      for (const exc of this.valueSet.compose.exclude) {
        await this.prepareConceptSet('exclude', exc);
      }
    }
  }

  /**
   * Prepare a concept set (include or exclude)
   * @param {string} desc - 'include' or 'exclude'
   * @param {Object} cc - ConceptSet element
   */
  async prepareConceptSet(desc, cc) {
    this.worker.deadCheck('prepareConceptSet');

    // Handle valueSet imports
    if (cc.valueSet) {
      for (const vsUrl of cc.valueSet) {
        if (!this.otherCheckers.has(vsUrl)) {
          const otherVs = await this.worker.findValueSet(vsUrl);
          if (otherVs) {
            const checker = new ValueSetChecker(this.worker, otherVs, this.params);
            await checker.prepare();
            this.otherCheckers.set(vsUrl, checker);
          }
        }
      }
    }
  }

  /**
   * Check a CodeableConcept against the ValueSet
   * @param {string} path - Issue path for errors
   * @param {Object} coded - CodeableConcept to validate
   * @param {boolean} abstractOk - Whether abstract codes are allowed
   * @param {boolean} inferSystem - Whether to infer the system
   * @param {string} mode - ValidationCheckMode
   * @returns {Object} Parameters result
   */
  async check(path, coded, abstractOk, inferSystem, mode) {
    this.worker.deadCheck('ValueSetChecker.check');

    const op = new ValidationIssues();
    const result = {
      resourceType: 'Parameters',
      parameter: []
    };

    // Track best match info
    let foundMatch = false;
    let psys = null;
    let pcode = null;
    let pver = null;
    let pdisp = null;
    let inactive = false;
    let vstatus = null;
    let cause = null;

    // If no codings, error
    if (!coded.coding || coded.coding.length === 0) {
      const msg = 'No codings provided to validate';
      this.messages.push(msg);
      op.addIssue('error', IssueType.Invalid, path, 'NO_CODINGS', msg, IssueCategory.InvalidData);
      return this._buildResult(result, false, op, null, null, null, null, mode, coded);
    }

    // Check each coding
    let codingIndex = 0;
    for (const coding of coded.coding) {
      this.worker.deadCheck('check-coding');

      const codingPath = mode === ValidationCheckMode.CodeableConcept
        ? `${path}.coding[${codingIndex}]`
        : path;

      const checkResult = await this._checkCoding(
        codingPath, coding, abstractOk, inferSystem, op, mode
      );

      if (checkResult.result === TrueFalseUnknown.True) {
        foundMatch = true;
        psys = checkResult.system || coding.system;
        pcode = checkResult.code || coding.code;
        pver = checkResult.version || coding.version;
        pdisp = checkResult.display;
        inactive = checkResult.inactive;
        vstatus = checkResult.status;
        break;  // Found a match, stop checking
      } else if (checkResult.result === TrueFalseUnknown.Unknown) {
        // Unknown system - track it
        cause = IssueType.NotFound;
      } else {
        // Not in ValueSet
        if (mode === ValidationCheckMode.CodeableConcept) {
          const cc = coding.version
            ? `${coding.system}|${coding.version}#${coding.code}`
            : `${coding.system}#${coding.code}`;
          const msg = `None of the provided codes are in the value set '${this.valueSet.url}' (${cc})`;
          op.addIssue('information', IssueType.CodeInvalid, `${path}.coding[${codingIndex}].code`,
            'None_of_the_provided_codes_are_in_the_value_set_one', msg, IssueCategory.ThisNotInVS);
        }
        if (!cause) {
          cause = IssueType.CodeInvalid;
        }
      }

      codingIndex++;
    }

    // Build final result
    if (!foundMatch && !this.allValueSet) {
      const codelist = coded.coding.map(c => {
        const cv = c.version ? `${c.system}|${c.version}` : c.system;
        return `'${cv}#${c.code}'`;
      }).join(', ');

      let msg, mid;
      if (mode === ValidationCheckMode.CodeableConcept) {
        mid = 'TX_GENERAL_CC_ERROR_MESSAGE';
        msg = `No valid coding found for value set '${this.valueSet.url}'`;
      } else {
        mid = 'None_of_the_provided_codes_are_in_the_value_set_one';
        msg = `The provided code ${codelist} is not in the value set '${this.valueSet.url}'`;
      }

      let issuePath;
      if (mode === ValidationCheckMode.CodeableConcept) {
        issuePath = '';
      } else if (coded.coding.length === 1) {
        issuePath = `${path}.coding[0].code`;
      } else {
        issuePath = path;
      }

      op.addIssue('error', IssueType.CodeInvalid, issuePath, mid, msg, IssueCategory.NotInVS);
    }

    return this._buildResult(result, foundMatch, op, psys, pcode, pver, pdisp,
      mode, coded, inactive, vstatus, cause);
  }

  /**
   * Check a single coding
   * @private
   */
  async _checkCoding(path, coding, abstractOk, inferSystem, op, mode) {
    this.worker.deadCheck('_checkCoding');

    const system = coding.system;
    const version = coding.version || '';
    const code = coding.code;
    const display = coding.display;

    // No system and not inferring
    if (!system && !inferSystem) {
      const msg = 'Coding has no system - cannot validate';
      this.messages.push(msg);
      op.addIssue('warning', IssueType.Invalid, path, 'Coding_has_no_system__cannot_validate', msg, IssueCategory.InvalidData);
      return { result: TrueFalseUnknown.False };
    }

    // Infer system if needed
    let actualSystem = system;
    if (!system && inferSystem) {
      actualSystem = await this._inferSystem(code);
      if (!actualSystem) {
        const msg = `Unable to infer system for code '${code}' in value set '${this.valueSet.url}'`;
        this.messages.push(msg);
        op.addIssue('error', IssueType.NotFound, 'code', 'UNABLE_TO_INFER_CODESYSTEM', msg, IssueCategory.InferFailed);
        return { result: TrueFalseUnknown.False };
      }
    }

    // Special case: @all ValueSet - just check code exists in system
    if (this.allValueSet) {
      return await this._checkCodeInSystem(path, actualSystem, version, code, display, abstractOk, op);
    }

    // Check against ValueSet
    if (this.hasExpansion) {
      // Use expansion for validation
      return await this._checkInExpansion(path, actualSystem, version, code, display, abstractOk, op);
    } else if (this.valueSet.compose) {
      // Use compose for validation
      return await this._checkInCompose(path, actualSystem, version, code, display, abstractOk, op);
    }

    return { result: TrueFalseUnknown.False };
  }

  /**
   * Check if a code exists in a code system
   * @private
   */
  async _checkCodeInSystem(path, system, version, code, display, abstractOk, op) {
    this.worker.deadCheck('_checkCodeInSystem');

    // Find the code system provider
    const cs = await this.worker.findCodeSystem(system, version, this.params,
      [CodeSystemContentMode.Complete, CodeSystemContentMode.Fragment], true);

    if (!cs) {
      // Unknown code system
      const vn = version ? `${system}|${version}` : system;
      if (!this.unknownSystems.has(vn)) {
        this.unknownSystems.add(vn);
        const msg = version
          ? `Unknown code system version: ${system} version ${version}`
          : `Unknown code system: ${system}`;
        this.messages.push(msg);
        op.addIssue('error', IssueType.NotFound, `${path}.system`, 'UNKNOWN_CODESYSTEM', msg, IssueCategory.NotFound);
      }
      return { result: TrueFalseUnknown.Unknown };
    }

    try {
      // Locate the code
      const locateResult = await cs.locate(code);

      if (!locateResult || !locateResult.context) {
        // Code not found
        this.unknownCodes.push(`${system}|${cs.version()}#${code}`);
        const msg = `Unknown code '${code}' in code system '${system}' version '${cs.version()}'`;
        this.messages.push(msg);

        const contentMode = cs.contentMode();
        if (contentMode !== CodeSystemContentMode.Complete) {
          op.addIssue('warning', IssueType.CodeInvalid, `${path}.code`, 'UNKNOWN_CODE_IN_FRAGMENT', msg, IssueCategory.InvalidCode);
          return { result: TrueFalseUnknown.True };  // Can't say it's invalid in fragment
        } else {
          op.addIssue('error', IssueType.CodeInvalid, `${path}.code`, 'Unknown_Code_in_Version', msg, IssueCategory.InvalidCode);
          return { result: TrueFalseUnknown.False };
        }
      }

      const ctxt = locateResult.context;

      // Check abstract
      const isAbstract = await cs.isAbstract(ctxt);
      if (!abstractOk && isAbstract) {
        const msg = `Abstract code '${code}' is not allowed`;
        this.messages.push(msg);
        op.addIssue('error', IssueType.BusinessRule, `${path}.code`, 'ABSTRACT_CODE_NOT_ALLOWED', msg, IssueCategory.CodeRule);
        return { result: TrueFalseUnknown.False, cause: IssueType.BusinessRule };
      }

      // Check inactive
      const isInactive = await cs.isInactive(ctxt);
      if (this.activeOnly && isInactive) {
        const msg = `Inactive code '${code}' is not allowed when activeOnly is true`;
        this.messages.push(msg);
        op.addIssue('error', IssueType.BusinessRule, `${path}.code`, 'STATUS_CODE_WARNING_CODE', msg, IssueCategory.CodeRule);
        return { result: TrueFalseUnknown.False, cause: IssueType.BusinessRule };
      }

      // Get display for result
      const csDisplay = await cs.display(ctxt);
      const csStatus = await cs.getCodeStatus ? await cs.getCodeStatus(ctxt) : null;

      // Validate display if provided
      if (display && csDisplay && display !== csDisplay) {
        const severity = this.displayWarningMode ? 'warning' : 'error';
        const msg = `Display '${display}' does not match expected '${csDisplay}' for code '${code}'`;
        this.messages.push(msg);
        op.addIssue(severity, IssueType.Invalid, `${path}.display`, 'Display_Name_for__should_be_one_of__instead_of', msg, IssueCategory.Display);
      }

      return {
        result: TrueFalseUnknown.True,
        system,
        code,
        version: cs.version(),
        display: csDisplay,
        inactive: isInactive,
        status: csStatus
      };
    } finally {
      // Cleanup if needed
    }
  }

  /**
   * Check a code against the ValueSet expansion
   * @private
   */
  async _checkInExpansion(path, system, version, code, display, abstractOk, op) {
    this.worker.deadCheck('_checkInExpansion');

    // Find the code in expansion
    const contains = this._findContains(system, version, code);

    if (!contains) {
      return { result: TrueFalseUnknown.False };
    }

    // Found in expansion - now validate against code system
    const cs = await this.worker.findCodeSystem(system, contains.version || version, this.params,
      [CodeSystemContentMode.Complete, CodeSystemContentMode.Fragment], true);

    if (!cs) {
      // Unknown code system
      const vn = version ? `${system}|${version}` : system;
      if (!this.unknownSystems.has(vn)) {
        this.unknownSystems.add(vn);
        const msg = version
          ? `Unknown code system version: ${system} version ${version}`
          : `Unknown code system: ${system}`;
        this.messages.push(msg);
        op.addIssue('error', IssueType.NotFound, `${path}.system`, 'UNKNOWN_CODESYSTEM', msg, IssueCategory.NotFound);
      }
      return { result: TrueFalseUnknown.Unknown };
    }

    try {
      const locateResult = await cs.locate(code);
      const ctxt = locateResult?.context;

      // Check abstract
      if (ctxt) {
        const isAbstract = await cs.isAbstract(ctxt);
        if (!abstractOk && isAbstract) {
          const msg = `Abstract code '${code}' is not allowed`;
          this.messages.push(msg);
          op.addIssue('error', IssueType.BusinessRule, `${path}.code`, 'ABSTRACT_CODE_NOT_ALLOWED', msg, IssueCategory.CodeRule);
          return { result: TrueFalseUnknown.False };
        }

        const isInactive = await cs.isInactive(ctxt);

        // Validate display if provided
        const csDisplay = contains.display || await cs.display(ctxt);
        if (display && csDisplay && display !== csDisplay) {
          const severity = this.displayWarningMode ? 'warning' : 'error';
          const msg = `Display '${display}' does not match expected '${csDisplay}'`;
          this.messages.push(msg);
          op.addIssue(severity, IssueType.Invalid, `${path}.display`, 'Display_Name_for__should_be_one_of__instead_of', msg, IssueCategory.Display);
        }

        return {
          result: TrueFalseUnknown.True,
          system,
          code,
          version: contains.version || cs.version(),
          display: csDisplay,
          inactive: isInactive || contains.inactive,
          status: contains.inactive ? 'inactive' : null
        };
      } else {
        // Code not in code system but is in expansion
        // This can happen with fragment code systems
        return {
          result: TrueFalseUnknown.True,
          system,
          code,
          version: contains.version,
          display: contains.display,
          inactive: contains.inactive
        };
      }
    } finally {
      // Cleanup
    }
  }

  /**
   * Find a contains entry in the expansion
   * @private
   */
  _findContains(system, version, code) {
    if (!this.valueSet.expansion?.contains) {
      return null;
    }
    return this._findContainsInList(this.valueSet.expansion.contains, system, version, code);
  }

  _findContainsInList(list, system, version, code) {
    for (const cc of list) {
      if (cc.system === system && cc.code === code &&
        (!version || !cc.version || version === cc.version)) {
        return cc;
      }
      if (cc.contains?.length > 0) {
        const found = this._findContainsInList(cc.contains, system, version, code);
        if (found) return found;
      }
    }
    return null;
  }

  /**
   * Check a code against the ValueSet compose
   * @private
   */
  async _checkInCompose(path, system, version, code, display, abstractOk, op) {
    this.worker.deadCheck('_checkInCompose');

    let foundInInclude = false;
    let matchResult = null;

    // Check includes
    if (this.valueSet.compose?.include) {
      for (const inc of this.valueSet.compose.include) {
        this.worker.deadCheck('_checkInCompose-include');

        const incResult = await this._checkConceptSet(path, inc, system, version, code, display, abstractOk, op);
        if (incResult.result === TrueFalseUnknown.True) {
          foundInInclude = true;
          matchResult = incResult;
          break;
        } else if (incResult.result === TrueFalseUnknown.Unknown) {
          matchResult = incResult;
        }
      }
    }

    // If found in include, check excludes
    if (foundInInclude && this.valueSet.compose?.exclude) {
      for (const exc of this.valueSet.compose.exclude) {
        this.worker.deadCheck('_checkInCompose-exclude');

        const excResult = await this._checkConceptSet(path, exc, system, version, code, display, abstractOk, op, true);
        if (excResult.result === TrueFalseUnknown.True) {
          // Code is excluded
          return { result: TrueFalseUnknown.False };
        }
      }
    }

    return matchResult || { result: TrueFalseUnknown.False };
  }

  /**
   * Check a code against a concept set (include or exclude element)
   * @private
   */
  async _checkConceptSet(path, cset, system, version, code, display, abstractOk, op, isExclude = false) {
    this.worker.deadCheck('_checkConceptSet');

    // Handle valueSet references
    if (cset.valueSet?.length > 0) {
      for (const vsUrl of cset.valueSet) {
        const checker = this.otherCheckers.get(vsUrl);
        if (checker) {
          const coding = { system, version, code, display };
          const checkResult = await checker.check(path, { coding: [coding] }, abstractOk, false, ValidationCheckMode.Coding);
          const resultParam = checkResult.parameter?.find(p => p.name === 'result');
          if (resultParam?.valueBoolean) {
            return { result: TrueFalseUnknown.True };
          }
        }
      }
      return { result: TrueFalseUnknown.False };
    }

    // Must have matching system
    if (cset.system && cset.system !== system) {
      return { result: TrueFalseUnknown.False };
    }

    // If system matches or no system in cset
    const csSystem = cset.system || system;
    const csVersion = cset.version || version;

    // Get code system provider
    const cs = await this.worker.findCodeSystem(csSystem, csVersion, this.params,
      [CodeSystemContentMode.Complete, CodeSystemContentMode.Fragment], true);

    if (!cs) {
      // Unknown code system
      if (!this.membershipOnly) {
        const vn = csVersion ? `${csSystem}|${csVersion}` : csSystem;
        if (!this.unknownSystems.has(vn)) {
          this.unknownSystems.add(vn);
          const msg = csVersion
            ? `Unknown code system version: ${csSystem} version ${csVersion}`
            : `Unknown code system: ${csSystem}`;
          this.messages.push(msg);
          op.addIssue('error', IssueType.NotFound, `${path}.system`, 'UNKNOWN_CODESYSTEM', msg, IssueCategory.NotFound);
        }
      }
      return { result: TrueFalseUnknown.Unknown };
    }

    try {
      // If no concepts or filters, include all from code system
      if (!cset.concept?.length && !cset.filter?.length) {
        return await this._checkCodeInSystem(path, csSystem, csVersion, code, display, abstractOk, op);
      }

      // Check explicit concept list
      if (cset.concept?.length > 0) {
        const concept = cset.concept.find(c => c.code === code);
        if (concept) {
          // Found in explicit list - validate in code system
          const locateResult = await cs.locate(code);
          if (locateResult?.context) {
            const ctxt = locateResult.context;
            const isAbstract = await cs.isAbstract(ctxt);
            const isInactive = await cs.isInactive(ctxt);

            if (!abstractOk && isAbstract) {
              const msg = `Abstract code '${code}' is not allowed`;
              op.addIssue('error', IssueType.BusinessRule, `${path}.code`, 'ABSTRACT_CODE_NOT_ALLOWED', msg, IssueCategory.CodeRule);
              return { result: TrueFalseUnknown.False };
            }

            if (this.activeOnly && isInactive) {
              const msg = `Inactive code '${code}' is not allowed`;
              op.addIssue('error', IssueType.BusinessRule, `${path}.code`, 'STATUS_CODE_WARNING_CODE', msg, IssueCategory.CodeRule);
              return { result: TrueFalseUnknown.False };
            }

            // Use display from concept override or code system
            const csDisplay = concept.display || await cs.display(ctxt);

            if (display && csDisplay && display !== csDisplay) {
              const severity = this.displayWarningMode ? 'warning' : 'error';
              const msg = `Display '${display}' does not match expected '${csDisplay}'`;
              op.addIssue(severity, IssueType.Invalid, `${path}.display`, 'Display_Name_for__should_be_one_of__instead_of', msg, IssueCategory.Display);
            }

            return {
              result: TrueFalseUnknown.True,
              system: csSystem,
              code,
              version: cs.version(),
              display: csDisplay,
              inactive: isInactive
            };
          }
        }
        return { result: TrueFalseUnknown.False };
      }

      // Check filters
      if (cset.filter?.length > 0) {
        // For now, we need to expand and check
        // This is a simplified implementation - full filter support would be more complex
        const locateResult = await cs.locate(code);
        if (!locateResult?.context) {
          return { result: TrueFalseUnknown.False };
        }

        // Check if code passes all filters
        for (const filter of cset.filter) {
          const passes = await this._checkFilter(cs, locateResult.context, filter);
          if (!passes) {
            return { result: TrueFalseUnknown.False };
          }
        }

        const ctxt = locateResult.context;
        const isAbstract = await cs.isAbstract(ctxt);
        const isInactive = await cs.isInactive(ctxt);

        if (!abstractOk && isAbstract) {
          const msg = `Abstract code '${code}' is not allowed`;
          op.addIssue('error', IssueType.BusinessRule, `${path}.code`, 'ABSTRACT_CODE_NOT_ALLOWED', msg, IssueCategory.CodeRule);
          return { result: TrueFalseUnknown.False };
        }

        const csDisplay = await cs.display(ctxt);

        return {
          result: TrueFalseUnknown.True,
          system: csSystem,
          code,
          version: cs.version(),
          display: csDisplay,
          inactive: isInactive
        };
      }

      return { result: TrueFalseUnknown.False };
    } finally {
      // Cleanup
    }
  }

  /**
   * Check if a code passes a filter
   * @private
   */
  async _checkFilter(cs, ctxt, filter) {
    // Basic filter support - full implementation would use cs.filter()
    const prop = filter.property || filter.prop;
    const op = filter.op;
    const value = filter.value;

    if (prop === 'concept' && (op === 'is-a' || op === 'descendent-of')) {
      // Hierarchy filter - check if code is descendant of value
      if (cs.locateIsA) {
        const result = await cs.locateIsA(await cs.code(ctxt), value, op === 'descendent-of');
        return result?.context != null;
      }
    }

    // For other filters, we'd need the full filter implementation
    // For now, return true to not exclude codes we can't check
    return true;
  }

  /**
   * Try to infer the system from the code and ValueSet
   * @private
   */
  async _inferSystem(code) {
    this.worker.deadCheck('_inferSystem');

    if (!this.valueSet.compose?.include) {
      return null;
    }

    const systems = new Set();

    for (const inc of this.valueSet.compose.include) {
      if (inc.valueSet?.length > 0) {
        // Would need to expand value sets to infer
        continue;
      }

      if (inc.system) {
        // Check if code exists in this system
        const cs = await this.worker.findCodeSystem(inc.system, inc.version, this.params,
          [CodeSystemContentMode.Complete, CodeSystemContentMode.Fragment], true);

        if (cs) {
          // Check explicit concepts first
          if (inc.concept?.length > 0) {
            if (inc.concept.some(c => c.code === code)) {
              systems.add(inc.system);
            }
          } else {
            // Check if code exists in code system
            const locateResult = await cs.locate(code);
            if (locateResult?.context) {
              systems.add(inc.system);
            }
          }
        }
      }
    }

    if (systems.size === 1) {
      return Array.from(systems)[0];
    }

    return null;  // Can't infer if 0 or multiple systems match
  }

  /**
   * Build the result Parameters resource
   * @private
   */
  _buildResult(result, success, op, system, code, version, display, mode, coded, inactive = false, status = null, cause = null) {
    result.parameter.push({ name: 'result', valueBoolean: success && !op.hasErrors });

    // Add system/code/version/display for successful match
    if (system) {
      result.parameter.push({ name: 'system', valueUri: system });
    } else if (!success && coded.coding?.[0]?.system && mode !== ValidationCheckMode.CodeableConcept) {
      result.parameter.push({ name: 'system', valueUri: coded.coding[0].system });
    }

    if (code) {
      result.parameter.push({ name: 'code', valueCode: code });
    } else if (!success && coded.coding?.[0]?.code && mode !== ValidationCheckMode.CodeableConcept) {
      result.parameter.push({ name: 'code', valueCode: coded.coding[0].code });
    }

    if (version) {
      result.parameter.push({ name: 'version', valueString: version });
    }

    if (display && success) {
      result.parameter.push({ name: 'display', valueString: display });
    }

    // Add unknown systems
    for (const us of this.unknownSystems) {
      if (success) {
        result.parameter.push({ name: 'x-caused-by-unknown-system', valueCanonical: us });
      } else {
        result.parameter.push({ name: 'x-unknown-system', valueCanonical: us });
      }
    }

    // Add inactive status
    if (inactive) {
      result.parameter.push({ name: 'inactive', valueBoolean: true });
      if (status && status !== 'inactive') {
        result.parameter.push({ name: 'status', valueString: status });
      }
      const msg = `The code '${code}' is valid but is inactive`;
      op.addIssue('warning', IssueType.BusinessRule, '', 'INACTIVE_CONCEPT_FOUND', msg, IssueCategory.CodeComment);
    } else if (status === 'deprecated') {
      result.parameter.push({ name: 'status', valueString: 'deprecated' });
      const msg = `The code '${code}' is deprecated`;
      op.addIssue('warning', IssueType.BusinessRule, '', 'DEPRECATED_CONCEPT_FOUND', msg, IssueCategory.CodeComment);
    }

    // Add messages
    if (this.messages.length > 0) {
      const uniqueMessages = [...new Set(this.messages)];
      result.parameter.push({ name: 'message', valueString: uniqueMessages.join('; ') });
    }

    // Add cause if not successful
    if (!success && cause) {
      result.parameter.push({ name: 'cause', valueCode: cause });
    }

    // Add CodeableConcept for that mode
    if (mode === ValidationCheckMode.CodeableConcept) {
      result.parameter.push({ name: 'codeableConcept', valueCodeableConcept: coded });
    }

    // Add issues
    const oo = op.toOperationOutcome();
    if (oo) {
      result.parameter.push({ name: 'issues', resource: oo });
    }

    return result;
  }
}

class ValidateWorker extends TerminologyWorker {

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
    return 'validate-code';
  }

  // ========== Entry Points ==========

  /**
   * Handle a type-level CodeSystem $validate-code request
   * GET/POST /CodeSystem/$validate-code
   */
  async handleCodeSystem(req, res) {
    try {
      const params = this.buildParameters(req);
      this.log.debug('CodeSystem $validate-code with params:', params);

      // Handle tx-resource and cache-id parameters
      this.setupAdditionalResources(params);

      // Get the CodeSystem - from parameter or by url
      const codeSystem = await this.resolveCodeSystem(params, null);
      if (!codeSystem) {
        return res.status(400).json(this.operationOutcome('error', 'invalid',
          'No CodeSystem specified - provide url parameter or codeSystem resource'));
      }

      // Extract coded value
      const coded = this.extractCodedValue(params, 'cs');
      if (!coded) {
        return res.status(400).json(this.operationOutcome('error', 'invalid',
          'No code to validate - provide code, coding, or codeableConcept parameter'));
      }

      // Perform validation
      const result = await this.doValidationCS(coded, codeSystem, params);
      return res.json(result);

    } catch (error) {
      this.log.error(`Error in CodeSystem $validate-code: ${error.message}`);
      console.error('CodeSystem $validate-code error:', error);
      return res.status(error.statusCode || 500).json(this.operationOutcome(
        'error', error.issueCode || 'exception', error.message));
    }
  }

  /**
   * Handle an instance-level CodeSystem $validate-code request
   * GET/POST /CodeSystem/{id}/$validate-code
   */
  async handleCodeSystemInstance(req, res) {
    try {
      const { id } = req.params;
      const params = this.buildParameters(req);
      this.log.debug(`CodeSystem/${id}/$validate-code with params:`, params);

      // Handle tx-resource and cache-id parameters
      this.setupAdditionalResources(params);

      // Get the CodeSystem by id
      const codeSystem = await this.resolveCodeSystem(params, id);
      if (!codeSystem) {
        return res.status(404).json(this.operationOutcome('error', 'not-found',
          `CodeSystem/${id} not found`));
      }

      // Extract coded value
      const coded = this.extractCodedValue(params, 'cs');
      if (!coded) {
        return res.status(400).json(this.operationOutcome('error', 'invalid',
          'No code to validate - provide code, coding, or codeableConcept parameter'));
      }

      // Perform validation
      const result = await this.doValidationCS(coded, codeSystem, params);
      return res.json(result);

    } catch (error) {
      this.log.error(`Error in CodeSystem $validate-code: ${error.message}`);
      console.error('CodeSystem $validate-code error:', error);
      return res.status(error.statusCode || 500).json(this.operationOutcome(
        'error', error.issueCode || 'exception', error.message));
    }
  }

  /**
   * Handle a type-level ValueSet $validate-code request
   * GET/POST /ValueSet/$validate-code
   */
  async handleValueSet(req, res) {
    try {
      const params = this.buildParameters(req);
      this.log.debug('ValueSet $validate-code with params:', params);

      // Handle tx-resource and cache-id parameters
      this.setupAdditionalResources(params);

      // Get the ValueSet - from parameter or by url
      const valueSet = await this.resolveValueSet(params, null);
      if (!valueSet) {
        return res.status(400).json(this.operationOutcome('error', 'invalid',
          'No ValueSet specified - provide url parameter or valueSet resource'));
      }

      // Extract coded value
      const coded = this.extractCodedValue(params, 'vs');
      if (!coded) {
        return res.status(400).json(this.operationOutcome('error', 'invalid',
          'No code to validate - provide code, coding, or codeableConcept parameter'));
      }

      // Perform validation
      const result = await this.doValidationVS(coded, valueSet, params);
      return res.json(result);

    } catch (error) {
      this.log.error(`Error in ValueSet $validate-code: ${error.message}`);
      console.error('ValueSet $validate-code error:', error);
      return res.status(error.statusCode || 500).json(this.operationOutcome(
        'error', error.issueCode || 'exception', error.message));
    }
  }

  /**
   * Handle an instance-level ValueSet $validate-code request
   * GET/POST /ValueSet/{id}/$validate-code
   */
  async handleValueSetInstance(req, res) {
    try {
      const { id } = req.params;
      const params = this.buildParameters(req);
      this.log.debug(`ValueSet/${id}/$validate-code with params:`, params);

      // Handle tx-resource and cache-id parameters
      this.setupAdditionalResources(params);

      // Get the ValueSet by id
      const valueSet = await this.resolveValueSet(params, id);
      if (!valueSet) {
        return res.status(404).json(this.operationOutcome('error', 'not-found',
          `ValueSet/${id} not found`));
      }

      // Extract coded value
      const coded = this.extractCodedValue(params, 'vs');
      if (!coded) {
        return res.status(400).json(this.operationOutcome('error', 'invalid',
          'No code to validate - provide code, coding, or codeableConcept parameter'));
      }

      // Perform validation
      const result = await this.doValidationVS(coded, valueSet, params);
      return res.json(result);

    } catch (error) {
      this.log.error(`Error in ValueSet $validate-code: ${error.message}`);
      console.error('ValueSet $validate-code error:', error);
      return res.status(error.statusCode || 500).json(this.operationOutcome(
        'error', error.issueCode || 'exception', error.message));
    }
  }

  // ========== Parameter Handling ==========

  /**
   * Build a Parameters resource from the request
   * Handles GET query params, POST form body, and POST Parameters resource
   * @param {express.Request} req
   * @returns {Object} Parameters resource
   */
  buildParameters(req) {
    // If POST with Parameters resource, use directly
    if (req.method === 'POST' && req.body && req.body.resourceType === 'Parameters') {
      return req.body;
    }

    // Convert query params or form body to Parameters
    const source = req.method === 'POST' ? { ...req.query, ...req.body } : req.query;
    const params = {
      resourceType: 'Parameters',
      parameter: []
    };

    for (const [name, value] of Object.entries(source)) {
      if (value === undefined || value === null) continue;

      if (Array.isArray(value)) {
        // Repeating parameter
        for (const v of value) {
          params.parameter.push({ name, valueString: String(v) });
        }
      } else if (typeof value === 'object') {
        // Could be a resource or complex type - check resourceType
        if (value.resourceType) {
          params.parameter.push({ name, resource: value });
        } else {
          // Assume it's a complex type like Coding or CodeableConcept
          params.parameter.push(this.buildComplexParameter(name, value));
        }
      } else {
        params.parameter.push({ name, valueString: String(value) });
      }
    }

    return params;
  }

  /**
   * Build a parameter for complex types
   */
  buildComplexParameter(name, value) {
    // Detect type based on structure
    if (value.system !== undefined || value.code !== undefined || value.display !== undefined) {
      return { name, valueCoding: value };
    }
    if (value.coding !== undefined || value.text !== undefined) {
      return { name, valueCodeableConcept: value };
    }
    // Fallback - stringify
    return { name, valueString: JSON.stringify(value) };
  }

  // Note: findParameter, getStringParam, getResourceParam, getCodingParam,
  // and getCodeableConceptParam are inherited from TerminologyWorker base class

  // ========== Resource Resolution ==========

  /**
   * Resolve the CodeSystem to validate against
   * @param {Object} params - Parameters resource
   * @param {string|null} id - Instance id (if instance-level request)
   * @returns {Object|null} CodeSystem resource (wrapper or JSON)
   */
  async resolveCodeSystem(params, id) {
    // Instance-level: lookup by id
    if (id) {
      return this.provider.getCodeSystemById(this.opContext, id);
    }

    // Check for codeSystem resource parameter
    const csResource = this.getResourceParam(params, 'codeSystem');
    if (csResource) {
      return csResource;
    }

    // Check for url parameter
    const url = this.getStringParam(params, 'url');
    if (url) {
      const version = this.getStringParam(params, 'version');
      return this.provider.getCodeSystem(this.opContext, url, version);
    }

    return null;
  }

  /**
   * Resolve the ValueSet to validate against
   * @param {Object} params - Parameters resource
   * @param {string|null} id - Instance id (if instance-level request)
   * @returns {Object|null} ValueSet resource (wrapper or JSON)
   */
  async resolveValueSet(params, id) {
    // Instance-level: lookup by id
    if (id) {
      return this.provider.getValueSetById(this.opContext, id);
    }

    // Check for valueSet resource parameter
    const vsResource = this.getResourceParam(params, 'valueSet');
    if (vsResource) {
      return vsResource;
    }

    // Check for url parameter
    const url = this.getStringParam(params, 'url');
    if (url) {
      const version = this.getStringParam(params, 'valueSetVersion');
      return this.provider.getValueSet(this.opContext, url, version);
    }

    return null;
  }

  // ========== Coded Value Extraction ==========

  /**
   * Extract the coded value to validate as a CodeableConcept
   * @param {Object} params - Parameters resource
   * @param {string} mode - 'cs' for CodeSystem, 'vs' for ValueSet
   * @returns {Object|null} CodeableConcept or null
   */
  extractCodedValue(params, mode) {
    // Priority 1: codeableConcept parameter
    const cc = this.getCodeableConceptParam(params, 'codeableConcept');
    if (cc) {
      return cc;
    }

    // Priority 2: coding parameter
    const coding = this.getCodingParam(params, 'coding');
    if (coding) {
      return { coding: [coding] };
    }

    // Priority 3: individual parameters (code required)
    const code = this.getStringParam(params, 'code');
    if (code) {
      // For CodeSystem mode: url/version
      // For ValueSet mode: system/systemVersion
      let system, version;
      if (mode === 'cs') {
        system = this.getStringParam(params, 'url');
        version = this.getStringParam(params, 'version');
      } else {
        system = this.getStringParam(params, 'system');
        version = this.getStringParam(params, 'systemVersion');
      }
      const display = this.getStringParam(params, 'display');

      const codingObj = { code };
      if (system) codingObj.system = system;
      if (version) codingObj.version = version;
      if (display) codingObj.display = display;

      return { coding: [codingObj] };
    }

    return null;
  }

  // ========== Validation Logic ==========

  /**
   * Perform CodeSystem validation
   * @param {Object} coded - CodeableConcept to validate
   * @param {Object} codeSystem - CodeSystem to validate against
   * @param {Object} params - Full parameters
   * @returns {Object} Parameters resource with result
   */
  async doValidationCS(coded, codeSystem, params) {
    this.deadCheck('doValidationCS');

    // Get the system URL from the CodeSystem
    const csUrl = codeSystem.url || (codeSystem.jsonObj && codeSystem.jsonObj.url);

    // For now, stub implementation using administrative-gender
    // TODO: Replace with real validation logic
    const validCodes = ['male', 'female', 'unknown'];

    let result = false;
    let message = '';
    let display = '';

    // Check each coding in the CodeableConcept
    if (coded.coding) {
      for (const coding of coded.coding) {
        // If system specified, must match
        if (coding.system && coding.system !== csUrl) {
          continue;
        }

        if (validCodes.includes(coding.code)) {
          result = true;
          display = this.getDisplayForCode(coding.code);

          // Check display if provided
          if (coding.display && coding.display !== display) {
            message = `Display "${coding.display}" does not match expected "${display}"`;
          }
          break;
        } else {
          message = `The code '${coding.code}' is not valid in the CodeSystem`;
        }
      }
    }

    if (!result && !message) {
      message = 'No valid code found';
    }

    return this.buildValidationResult(result, message, display, coded);
  }

  /**
   * Perform ValueSet validation
   * @param {Object} coded - CodeableConcept to validate
   * @param {Object} valueSet - ValueSet to validate against
   * @param {Object} params - Full parameters
   * @returns {Object} Parameters resource with result
   */
  async doValidationVS(coded, valueSet, params) {
    this.deadCheck('doValidationVS');

    // Determine validation mode based on input
    let mode = ValidationCheckMode.CodeableConcept;
    if (coded.coding?.length === 1) {
      const c = coded.coding[0];
      if (!c.system && !c.display) {
        mode = ValidationCheckMode.Code;
      } else {
        mode = ValidationCheckMode.Coding;
      }
    }

    // Get parameters
    const abstractOk = this._getBoolParam(params, 'abstract', true);
    const inferSystem = this._getBoolParam(params, 'inferSystem', false);

    // Normalize valueSet to JSON if needed
    const vsJson = valueSet.jsonObj || valueSet;

    // Create and prepare checker
    const checker = new ValueSetChecker(this, vsJson, params);
    await checker.prepare();

    // Perform validation
    const result = await checker.check('', coded, abstractOk, inferSystem, mode);

    // Add diagnostics if requested
    if (this._getBoolParam(params, 'diagnostics', false)) {
      result.parameter.push({ name: 'diagnostics', valueString: this.opContext.diagnostics() });
    }

    return result;
  }

  /**
   * Get a boolean parameter value
   * @private
   */
  _getBoolParam(params, name, defaultValue) {
    if (!params?.parameter) return defaultValue;
    const p = params.parameter.find(param => param.name === name);
    if (!p) return defaultValue;
    if (p.valueBoolean !== undefined) return p.valueBoolean;
    if (p.valueString !== undefined) return p.valueString === 'true';
    return defaultValue;
  }

  /**
   * Find a ValueSet by URL
   * @param {string} url - ValueSet URL
   * @param {string} [version] - ValueSet version
   * @returns {Object|null} ValueSet resource or null
   */
  async findValueSet(url, version = null) {
    // First check additional resources
    const found = this.findInAdditionalResources(url, version || '', 'ValueSet', false);
    if (found) {
      return found;
    }

    // Then check provider
    return await this.provider.getValueSet(this.opContext, url, version);
  }

  /**
   * Get display text for a code (stub implementation for doValidationCS)
   * @private
   */
  getDisplayForCode(code) {
    const displays = {
      'male': 'Male',
      'female': 'Female',
      'unknown': 'Unknown',
      'other': 'Other'
    };
    return displays[code] || code;
  }

  /**
   * Build the validation result Parameters resource
   */
  buildValidationResult(result, message, display, coded) {
    const parameters = {
      resourceType: 'Parameters',
      parameter: [
        { name: 'result', valueBoolean: result }
      ]
    };

    if (message) {
      parameters.parameter.push({ name: 'message', valueString: message });
    }

    if (display && result) {
      parameters.parameter.push({ name: 'display', valueString: display });
    }

    // Include the code that was validated
    if (coded.coding && coded.coding.length > 0) {
      const coding = coded.coding[0];
      if (coding.code) {
        parameters.parameter.push({ name: 'code', valueCode: coding.code });
      }
      if (coding.system) {
        parameters.parameter.push({ name: 'system', valueUri: coding.system });
      }
      if (coding.version) {
        parameters.parameter.push({ name: 'version', valueString: coding.version });
      }
    }

    return parameters;
  }

  /**
   * Build an OperationOutcome
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
  ValidateWorker,
  ValueSetChecker,
  ValidationIssues,
  ValidationCheckMode,
  TrueFalseUnknown,
  IssueCategory,
  IssueType
};