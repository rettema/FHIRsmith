
const {TerminologyWorker} = require("./worker");

/**
 * this handles assembling the information for the operations form
 */
class OperationsWorker extends TerminologyWorker {
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
    return 'search';
  }

  async handle(req, res) {
    const formData = { resourceType : "Operations" };
    formData.valueSets = await this.provider.listAllValueSets();
    return res.json(formData);
  }
}

module.exports = { OperationsWorker };