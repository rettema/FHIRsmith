//
// Subsumes Worker - Handles CodeSystem $subsumes operation
//
// GET /CodeSystem/$subsumes?{params}
// POST /CodeSystem/$subsumes
// GET /CodeSystem/{id}/$subsumes?{params}
// POST /CodeSystem/{id}/$subsumes
//

const { TerminologyWorker } = require('./worker');
const { FhirCodeSystemProvider } = require('../cs/cs-cs');

class SubsumesWorker extends TerminologyWorker {
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
    return 'subsumes';
  }

  /**
   * Handle a type-level $subsumes request
   * GET/POST /CodeSystem/$subsumes
   * @param {express.Request} req - Express request
   * @param {express.Response} res - Express response
   */
  async handle(req, res) {
    try {
      await this.handleTypeLevelSubsumes(req, res);
    } catch (error) {
      this.log.error(`Error in $subsumes: ${error.message}`);
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
   * Handle an instance-level $subsumes request
   * GET/POST /CodeSystem/{id}/$subsumes
   * @param {express.Request} req - Express request
   * @param {express.Response} res - Express response
   */
  async handleInstance(req, res) {
    try {
      await this.handleInstanceLevelSubsumes(req, res);
    } catch (error) {
      this.log.error(`Error in $subsumes: ${error.message}`);
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
   * Handle type-level subsumes: /CodeSystem/$subsumes
   * CodeSystem identified by system+version params or from codingA/codingB
   */
  async handleTypeLevelSubsumes(req, res) {
    this.deadCheck('subsumes-type-level');

    // Handle tx-resource and cache-id parameters from Parameters resource
    if (req.body && req.body.resourceType === 'Parameters') {
      this.setupAdditionalResources(req.body);
    }

    // Parse parameters from request
    const params = this.parseParameters(req);

    // Get the codings and code system provider
    let codingA, codingB;
    let csProvider;

    if (params.codingA && params.codingB) {
      // Using codingA and codingB (only from Parameters resource)
      codingA = params.codingA;
      codingB = params.codingB;

      // Codings must have the same system
      if (codingA.system !== codingB.system) {
        return res.status(400).json(this.operationOutcome('error', 'invalid',
          'codingA and codingB must have the same system'));
      }

      // Get the code system provider from the coding's system
      csProvider = await this.findCodeSystem(codingA.system, codingA.version || '', params, ['complete'], true);

    } else if (params.codeA && params.codeB) {
      // Using codeA, codeB - system is required
      if (!params.system) {
        return res.status(400).json(this.operationOutcome('error', 'invalid',
          'system parameter is required when using codeA and codeB'));
      }

      csProvider = await this.findCodeSystem(params.system, params.version || '', params, ['complete'], true);

      if (csProvider) {
        // Create codings from the codes
        codingA = {
          system: csProvider.system(),
          version: csProvider.version(),
          code: params.codeA
        };
        codingB = {
          system: csProvider.system(),
          version: csProvider.version(),
          code: params.codeB
        };
      }

    } else {
      return res.status(400).json(this.operationOutcome('error', 'invalid',
        'Must provide either codingA and codingB, or codeA and codeB with system'));
    }

    if (!csProvider) {
      const systemUrl = params.system || params.codingA?.system;
      return res.status(404).json(this.operationOutcome('error', 'not-found',
        `CodeSystem not found: ${systemUrl}`));
    }

    // Perform the subsumes check
    const result = await this.doSubsumes(csProvider, codingA, codingB);
    return res.json(result);
  }

  /**
   * Handle instance-level subsumes: /CodeSystem/{id}/$subsumes
   * CodeSystem identified by resource ID
   */
  async handleInstanceLevelSubsumes(req, res) {
    this.deadCheck('subsumes-instance-level');

    const { id } = req.params;

    // Find the CodeSystem by ID
    const codeSystem = await this.provider.getCodeSystemById(this.opContext, id);

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

    // Load any supplements
    const supplements = this.loadSupplements(codeSystem.url, codeSystem.version);

    // Create a FhirCodeSystemProvider for this CodeSystem
    const csProvider = new FhirCodeSystemProvider(this.opContext, codeSystem, supplements);

    // Get the codings
    let codingA, codingB;

    if (params.codingA && params.codingB) {
      codingA = params.codingA;
      codingB = params.codingB;
    } else if (params.codeA && params.codeB) {
      // Create codings from the codes using this CodeSystem
      codingA = {
        system: csProvider.system(),
        version: csProvider.version(),
        code: params.codeA
      };
      codingB = {
        system: csProvider.system(),
        version: csProvider.version(),
        code: params.codeB
      };
    } else {
      return res.status(400).json(this.operationOutcome('error', 'invalid',
        'Must provide either codingA and codingB, or codeA and codeB'));
    }

    // Perform the subsumes check
    const result = await this.doSubsumes(csProvider, codingA, codingB);
    return res.json(result);
  }

  /**
   * Parse parameters from request (query params, form body, or Parameters resource)
   * @param {express.Request} req - Express request
   * @returns {Object} Parsed parameters
   */
  parseParameters(req) {
    const result = {
      codeA: null,
      codeB: null,
      system: null,
      version: null,
      codingA: null,
      codingB: null
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

      switch (name) {
        case 'codeA':
          result.codeA = this.extractParameterValue(param, name);
          break;
        case 'codeB':
          result.codeB = this.extractParameterValue(param, name);
          break;
        case 'system':
          result.system = this.extractParameterValue(param, name);
          break;
        case 'version':
          result.version = this.extractParameterValue(param, name);
          break;
        case 'codingA':
          if (param.valueCoding) {
            result.codingA = param.valueCoding;
          } else {
            this.opContext.log(`Parameter 'codingA' should be valueCoding, got different type`);
          }
          break;
        case 'codingB':
          if (param.valueCoding) {
            result.codingB = param.valueCoding;
          } else {
            this.opContext.log(`Parameter 'codingB' should be valueCoding, got different type`);
          }
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
      codeA: 'valueCode',
      codeB: 'valueCode',
      system: 'valueUri',
      version: 'valueString'
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

    if (params.codeA) result.codeA = params.codeA;
    if (params.codeB) result.codeB = params.codeB;
    if (params.system) result.system = params.system;
    if (params.version) result.version = params.version;
  }

  /**
   * Perform the actual subsumes check
   * @param {CodeSystemProvider} csProvider - CodeSystem provider
   * @param {Object} codingA - First coding
   * @param {Object} codingB - Second coding
   * @returns {Object} Parameters resource with subsumes result
   */
  async doSubsumes(csProvider, codingA, codingB) {
    this.deadCheck('doSubsumes');

    const csSystem = csProvider.system();

    // Check system uri matches for both codings
    if (csSystem !== codingA.system) {
      const error = new Error(`System uri / code uri mismatch - not supported at this time (${csSystem}/${codingA.system})`);
      error.statusCode = 400;
      error.issueCode = 'not-supported';
      throw error;
    }
    if (csSystem !== codingB.system) {
      const error = new Error(`System uri / code uri mismatch - not supported at this time (${csSystem}/${codingB.system})`);
      error.statusCode = 400;
      error.issueCode = 'not-supported';
      throw error;
    }

    // Validate both codes exist
    const locateA = await csProvider.locate(codingA.code);
    if (!locateA || !locateA.context) {
      const error = new Error(`Invalid code: '${codingA.code}' not found in CodeSystem '${csSystem}'`);
      error.statusCode = 404;
      error.issueCode = 'not-found';
      throw error;
    }

    const locateB = await csProvider.locate(codingB.code);
    if (!locateB || !locateB.context) {
      const error = new Error(`Invalid code: '${codingB.code}' not found in CodeSystem '${csSystem}'`);
      error.statusCode = 404;
      error.issueCode = 'not-found';
      throw error;
    }

    // Determine the subsumption relationship
    let outcome = await csProvider.subsumesTest(codingA.code, codingB.code);

    return {
      resourceType: 'Parameters',
      parameter: [
        {
          name: 'outcome',
          valueCode: outcome
        }
      ]
    };
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

module.exports = SubsumesWorker;