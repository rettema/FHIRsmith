const path = require('path');
const { LanguageDefinitions } = require('../library/languages');
const {I18nSupport} = require("../library/i18nsupport");

class TestUtilities {
  static i18n;
  static langDefs;

  static async loadLanguageDefinitions() {
    if (!this.langDefs) {
      this.langDefs = await LanguageDefinitions.fromFile(path.join(__dirname, '../tx/data/lang.dat'));
    }
    return this.langDefs;
  }

  static async loadTranslations(languageDefinitions) {
    if (!this.i18n) {
      this.i18n = new I18nSupport(path.join(__dirname, '../translations'), languageDefinitions);
      await this.i18n.load();
    }
    return this.i18n;
  }
}

module.exports = {
  TestUtilities
};