//
// Lookup Worker - Handles CodeSystem $lookup operation
//
// GET /CodeSystem/$lookup?{params}
// POST /CodeSystem/$lookup
// GET /CodeSystem/{id}/$lookup?{params}
// POST /CodeSystem/{id}/$lookup
//

const { TerminologyWorker } = require('./worker');
const { FhirCodeSystemProvider } = require('../cs/cs-cs');

class LookupWorker extends TerminologyWorker {
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
    return 'lookup';
  }

  /**
   * Static factory method to handle type-level lookup from Express
   * GET/POST /CodeSystem/$lookup
   * @param {express.Request} req - Express request
   * @param {express.Response} res - Express response
   */
  async handle(req, res) {
    try {
      await this.handleTypeLevelLookup(req, res);
    } catch (error) {
      this.log.error(`Error in $lookup: ${error.message}`);
      console.error('$lookup error:', error); // Full stack trace for debugging
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
   * Static factory method to handle instance-level lookup from Express
   * GET/POST /CodeSystem/{id}/$lookup
   * @param {express.Request} req - Express request
   * @param {express.Response} res - Express response
   */
  async handleInstance(req, res) {

    try {
      await this.handleInstanceLevelLookup(req, res);
    } catch (error) {
      this.log.error(`Error in $lookup: ${error.message}`);
      console.error('$lookup error:', error); // Full stack trace for debugging
      //      const statusCode = error.statusCode || 500;
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
   * Handle type-level lookup: /CodeSystem/$lookup
   * CodeSystem identified by system+version params or coding parameter
   */
  async handleTypeLevelLookup(req, res) {
    this.deadCheck('lookup-type-level');

    // Handle tx-resource and cache-id parameters from Parameters resource
    if (req.body && req.body.resourceType === 'Parameters') {
      this.setupAdditionalResources(req.body);
    }

    // Parse parameters from request
    const params = this.parseParameters(req);

    // Determine how the code system is identified
    let csProvider;
    let code;

    if (params.coding) {
      // Coding parameter provided - extract system, version, code
      const coding = params.coding;
      if (!coding.system) {
        return res.status(400).json(this.operationOutcome('error', 'invalid',
          'Coding parameter must include a system'));
      }
      if (!coding.code) {
        return res.status(400).json(this.operationOutcome('error', 'invalid',
          'Coding parameter must include a code'));
      }

      // Allow complete or fragment content modes, nullOk = true to handle not-found ourselves
      csProvider = await this.findCodeSystem(coding.system, coding.version || '', params, ['complete', 'fragment'], true);
      code = coding.code;

    } else if (params.system && params.code) {
      // system + code parameters
      csProvider = await this.findCodeSystem(params.system, params.version || '', params, ['complete', 'fragment'], true);
      code = params.code;

    } else {
      return res.status(400).json(this.operationOutcome('error', 'invalid',
        'Must provide either coding parameter, or system and code parameters'));
    }

    if (!csProvider) {
      const systemUrl = params.system || params.coding?.system;
      const versionStr = params.version || params.coding?.version;
      const msg = versionStr
        ? `CodeSystem not found: ${systemUrl} version ${versionStr}`
        : `CodeSystem not found: ${systemUrl}`;
      return res.status(404).json(this.operationOutcome('error', 'not-found', msg));
    }

    // Perform the lookup
    const result = await this.doLookup(csProvider, code, params);
    return res.json(result);
  }

  /**
   * Handle instance-level lookup: /CodeSystem/{id}/$lookup
   * CodeSystem identified by resource ID
   */
  async handleInstanceLevelLookup(req, res) {
    this.deadCheck('lookup-instance-level');

    const { id } = req.params;

    // Find the CodeSystem by ID
    let codeSystem = this.provider.getCodeSystemById(this.opContext, id);

    if (!codeSystem) {
      return res.status(404).json(this.operationOutcome('error', 'not-found',
        `CodeSystem/${id} not found`));
    }

    // Handle tx-resource and cache-id parameters from Parameters resource
    if (req.body && req.body.resourceType === 'Parameters') {
      this.setupAdditionalResources(req.body);
    }

    // Parse parameters from request
    const params = this.parseParameters(req);

    // For instance-level, code is required (system/version come from the resource)
    let code;
    if (params.coding) {
      code = params.coding.code;
    } else if (params.code) {
      code = params.code;
    } else {
      return res.status(400).json(this.operationOutcome('error', 'invalid',
        'Must provide code parameter or coding parameter with code'));
    }

    // Load any supplements
    const supplements = this.loadSupplements(codeSystem.url, codeSystem.version);

    // Create a FhirCodeSystemProvider for this CodeSystem
    const csProvider = new FhirCodeSystemProvider(this.opContext, codeSystem, supplements);

    // Perform the lookup
    const result = await this.doLookup(csProvider, code, params);
    return res.json(result);
  }

  /**
   * Parse parameters from request (query params, form body, or Parameters resource)
   * @param {express.Request} req - Express request
   * @returns {Object} Parsed parameters
   */
  parseParameters(req) {
    const result = {
      // Single-value parameters
      code: null,
      system: null,
      version: null,
      date: null,
      displayLanguage: null,
      coding: null,
      // Repeating parameters
      property: [],
      useSupplement: []
    };

    // Check if body is a Parameters resource
    if (req.body && req.body.resourceType === 'Parameters') {
      this.parseParametersResource(req.body, result);
    } else {
      // Parse from query params or form body
      const params = req.method === 'POST' ? req.body : req.query;
      this.parseSimpleParameters(params, result);
    }

    return result;
  }

  /**
   * Parse parameters from a FHIR Parameters resource
   * @param {Object} parametersResource - The Parameters resource
   * @param {Object} result - Result object to populate
   */
  parseParametersResource(parametersResource, result) {
    if (!parametersResource.parameter || !Array.isArray(parametersResource.parameter)) {
      return;
    }

    for (const param of parametersResource.parameter) {
      if (!param.name) continue;

      const name = param.name;
      const value = this.extractParameterValue(param, name);

      if (value === null || value === undefined) continue;

      switch (name) {
        case 'code':
          result.code = value;
          break;
        case 'system':
          result.system = value;
          break;
        case 'version':
          result.version = value;
          break;
        case 'date':
          result.date = value;
          break;
        case 'displayLanguage':
          result.displayLanguage = value;
          break;
        case 'coding':
          if (param.valueCoding) {
            result.coding = param.valueCoding;
          } else {
            this.opContext.log(`Parameter 'coding' should be valueCoding, got different type`);
          }
          break;
        case 'property':
          result.property.push(value);
          break;
        case 'useSupplement':
          result.useSupplement.push(value);
          break;
        default:
          // Unknown parameter - ignore
          break;
      }
    }
  }

  /**
   * Extract value from a parameter, being lenient about types
   * @param {Object} param - Parameter object from Parameters resource
   * @param {string} name - Parameter name (for logging)
   * @returns {*} Extracted value or null
   */
  extractParameterValue(param, name) {
    // Expected types for each parameter
    const expectedTypes = {
      code: 'valueCode',
      system: 'valueUri',
      version: 'valueString',
      date: 'valueDateTime',
      displayLanguage: 'valueCode',
      property: 'valueCode',
      useSupplement: 'valueCanonical',
      coding: "valueCoding"
    };

    const expectedType = expectedTypes[name];

    // Check for the expected type first
    if (expectedType && param[expectedType] !== undefined) {
      return param[expectedType];
    }

    // Be lenient - accept any primitive value type
    const valueTypes = [
      'valueString', 'valueCode', 'valueUri', 'valueCanonical',
      'valueDateTime', 'valueDate', 'valueBoolean', 'valueInteger',
      'valueDecimal', 'valueId', 'valueOid', 'valueUuid', 'valueUrl'
    ];

    for (const valueType of valueTypes) {
      if (param[valueType] !== undefined) {
        if (expectedType && valueType !== expectedType) {
          this.opContext.log(`Parameter '${name}' expected ${expectedType}, got ${valueType}`);
        }
        return param[valueType];
      }
    }

    return null;
  }

  /**
   * Parse simple parameters from query string or form body
   * @param {Object} params - Query params or form body
   * @param {Object} result - Result object to populate
   */
  parseSimpleParameters(params, result) {
    if (!params) return;

    // Single-value parameters
    if (params.code) result.code = params.code;
    if (params.system) result.system = params.system;
    if (params.version) result.version = params.version;
    if (params.date) result.date = params.date;
    if (params.displayLanguage) result.displayLanguage = params.displayLanguage;

    // Handle repeating parameters (can be string or array)
    if (params.property) {
      result.property = Array.isArray(params.property) ? params.property : [params.property];
    }
    if (params.useSupplement) {
      result.useSupplement = Array.isArray(params.useSupplement) ? params.useSupplement : [params.useSupplement];
    }
  }

  /**
   * Perform the actual lookup operation
   * @param {CodeSystemProvider} csProvider - CodeSystem provider
   * @param {string} code - Code to look up
   * @param {Object} params - Parsed parameters
   * @returns {Object} Parameters resource with lookup result
   */
  async doLookup(csProvider, code, params) {
    this.deadCheck('doLookup');

    // Helper to check if a property should be included
    const hasProp = (name, defaultValue = true) => {
      if (!params.property || params.property.length === 0) {
        return defaultValue;
      }
      const lowerName = name.toLowerCase();
      return params.property.some(p =>
        p.toLowerCase() === lowerName || p === '*'
      );
    };

    // Locate the code in the code system
    const locateResult = await csProvider.locate(code);

    if (!locateResult || !locateResult.context) {
      const message = locateResult?.message ||
        `Unable to find code '${code}' in ${csProvider.system()} version ${csProvider.version() || 'unknown'}`;
      const error = new Error(message);
      error.statusCode = 404;
      error.issueCode = 'not-found';
      throw error;
    }

    const ctxt = locateResult.context;

    // Build the response parameters
    const responseParams = [];

    // name (required)
    responseParams.push({
      name: 'name',
      valueString: csProvider.name()
    });

    // version (optional)
    const version = csProvider.version();
    if (version) {
      responseParams.push({
        name: 'version',
        valueString: version
      });
    }

    // display (required)
    const display = await csProvider.display(ctxt);
    responseParams.push({
      name: 'display',
      valueString: display || code
    });

    // definition (optional) - top-level parameter
    if (hasProp('definition', true)) {
      const definition = await csProvider.definition(ctxt);
      if (definition) {
        responseParams.push({
          name: 'definition',
          valueString: definition
        });
      }
    }

    // abstract property (optional)
    if (hasProp('abstract', true)) {
      const isAbstract = await csProvider.isAbstract(ctxt);
      if (isAbstract) {
        responseParams.push({
          name: 'property',
          part: [
            { name: 'code', valueCode: 'abstract' },
            { name: 'value', valueBoolean: true }
          ]
        });
      }
    }

    // inactive property (optional)
    if (hasProp('inactive', true)) {
      const isInactive = await csProvider.isInactive(ctxt);
      responseParams.push({
        name: 'property',
        part: [
          { name: 'code', valueCode: 'inactive' },
          { name: 'value', valueBoolean: isInactive }
        ]
      });
    }

    // designations (optional)
    if (hasProp('designation', false)) {
      const designations = await csProvider.designations(ctxt);
      if (designations && Array.isArray(designations)) {
        for (const designation of designations) {
          this.deadCheck('doLookup-designations');
          const designationParts = [];

          if (designation.language) {
            designationParts.push({
              name: 'language',
              valueCode: designation.language
            });
          }

          if (designation.use) {
            designationParts.push({
              name: 'use',
              valueCoding: designation.use
            });
          }

          designationParts.push({
            name: 'value',
            valueString: designation.value
          });

          responseParams.push({
            name: 'designation',
            part: designationParts
          });
        }
      }
    }

    // Let the provider add additional properties
    if (csProvider.extendLookup) {
      await csProvider.extendLookup(ctxt, params.property || [], responseParams);
    }

    return {
      resourceType: 'Parameters',
      parameter: responseParams
    };
  }

  /**
   * Add a property to the response parameters
   * @param {Array} responseParams - Response parameters array
   * @param {string} code - Property code
   * @param {*} value - Property value
   * @param {string} valueType - FHIR value type (e.g., 'valueString', 'valueBoolean')
   */
  addProperty(responseParams, code, value, valueType) {
    responseParams.push({
      name: 'property',
      part: [
        { name: 'code', valueCode: code },
        { name: 'value', [valueType]: value }
      ]
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

module.exports = LookupWorker;