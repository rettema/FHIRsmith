//
// Read Worker - Handles resource read operations
//
// GET /{type}/{id}
//

const { TerminologyWorker } = require('./worker');

class ReadWorker extends TerminologyWorker {
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
    return 'read';
  }
  /**
   * Handle a read request
   * @param {express.Request} req - Express request (with txProvider attached)
   * @param {express.Response} res - Express response
   * @param {string} resourceType - The resource type (CodeSystem, ValueSet, ConceptMap)
   * @param {Object} log - Logger instance
   */
  async handle(req, res, resourceType) {
    const { id } = req.params;

    this.log.debug(`Read ${resourceType}/${id}`);

    try {
      switch (resourceType) {
        case 'CodeSystem':
          return this.handleCodeSystem(req, res, id);

        case 'ValueSet':
          return await this.handleValueSet(req, res, id);

        case 'ConceptMap':
          return res.status(501).json({
            resourceType: 'OperationOutcome',
            issue: [{
              severity: 'error',
              code: 'not-supported',
              diagnostics: 'ConceptMap read not yet implemented'
            }]
          });

        default:
          return res.status(404).json({
            resourceType: 'OperationOutcome',
            issue: [{
              severity: 'error',
              code: 'not-found',
              diagnostics: `Unknown resource type: ${resourceType}`
            }]
          });
      }
    } catch (error) {
      this.log.error(`Error reading ${resourceType}/${id}:`, error);
      console.error('$lookup error:', error); // Full stack trace for debugging
      return res.status(500).json({
        resourceType: 'OperationOutcome',
        issue: [{
          severity: 'error',
          code: 'exception',
          diagnostics: error.message
        }]
      });
    }
  }

  /**
   * Handle CodeSystem read
   */
  handleCodeSystem(req, res, id) {
    let cs = this.provider.getCodeSystemById(this.opContext, id);
    if (cs != null) {
      return res.json(cs.jsonObj);
    }

    return res.status(404).json({
      resourceType: 'OperationOutcome',
      issue: [{
        severity: 'error',
        code: 'not-found',
        diagnostics: `CodeSystem/${id} not found`
      }]
    });
  }

  /**
   * Handle ValueSet read
   */
  async handleValueSet(req, res, id) {
    // Iterate through valueSetProviders in order
    for (const vsp of this.provider.valueSetProviders) {
      this.deadCheck('handleValueSet-loop');
      const vs = await vsp.fetchValueSetById(id);
      if (vs) {
        return res.json(vs.jsonObj);
      }
    }

    return res.status(404).json({
      resourceType: 'OperationOutcome',
      issue: [{
        severity: 'error',
        code: 'not-found',
        diagnostics: `ValueSet/${id} not found`
      }]
    });
  }
}

module.exports = ReadWorker;