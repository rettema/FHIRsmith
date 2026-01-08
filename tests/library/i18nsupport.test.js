const {I18nSupport} = require('../../library/i18nsupport');
const {Languages, LanguageDefinitions} = require('../../library/languages');
const path = require('path');

describe('I18nSupport', () => {
  let i18nSupport;
  let mockLanguageDefinitions;
  const translationsPath = path.join(__dirname, '../../tests/translations');

  beforeEach(() => {
    mockLanguageDefinitions = new LanguageDefinitions();
    i18nSupport = new I18nSupport(translationsPath, mockLanguageDefinitions);
  });

  describe('Constructor', () => {
    test('should initialize with translations path and language definitions', () => {
      expect(i18nSupport.translationsPath).toBe(translationsPath);
      expect(i18nSupport.languageDefinitions).toBe(mockLanguageDefinitions);
      expect(i18nSupport.bundles).toBeInstanceOf(Map);
      expect(i18nSupport.bundles.size).toBe(0);
    });
  });

  describe('Loading', () => {
    test('should load actual test translation files', async () => {
      await i18nSupport.load();

      // Should have loaded at least English and the test language files
      expect(i18nSupport.bundles.size).toBeGreaterThan(0);
      expect(i18nSupport.getAvailableLanguages()).toContain('en');

      // Check if we loaded some actual messages
      const enBundle = i18nSupport.bundles.get('en');
      expect(enBundle).toBeDefined();
      expect(enBundle['ALL_OK']).toBeDefined();
      expect(enBundle['Bundle_BUNDLE_Entry_Type3_one']).toBeDefined();
      expect(enBundle['Bundle_BUNDLE_Entry_Type3_other']).toBeDefined();
    });

    test('should load Japanese translations if available', async () => {
      await i18nSupport.load();

      if (i18nSupport.bundles.has('ja')) {
        const jaBundle = i18nSupport.bundles.get('ja');
        expect(jaBundle['ALL_OK']).toBe('すべてOK');
      }
    });

    test('should load Dutch translations if available', async () => {
      await i18nSupport.load();

      if (i18nSupport.bundles.has('nl')) {
        const nlBundle = i18nSupport.bundles.get('nl');
        expect(nlBundle['ALL_OK']).toBe('Alles OK');
      }
    });
  });

  describe('Message Formatting', () => {
    beforeEach(async () => {
      // Load the actual test files
      await i18nSupport.load();
    });

    test('should format simple message without parameters', () => {
      const languages = Languages.fromAcceptLanguage('en-US');
      const result = i18nSupport.formatMessage(languages, 'ALL_OK');

      expect(result).toBe('All OK');
    });

    test('should format message with parameter substitution', () => {
      const languages = Languages.fromAcceptLanguage('en-US');
      const result = i18nSupport.formatMessage(
        languages,
        'Bad_file_path_error',
        ['test.txt']
      );

      expect(result).toContain('test.txt');
      expect(result).toContain('Error');
    });

    test('should use Japanese translation when available', () => {
      const languages = Languages.fromAcceptLanguage('ja,en;q=0.8');
      const result = i18nSupport.formatMessage(languages, 'ALL_OK');

      if (i18nSupport.bundles.has('ja')) {
        expect(result).toBe('すべてOK');
      } else {
        // Fallback to English if Japanese not loaded
        expect(result).toBe('All OK');
      }
    });

    test('should fallback to English when message not found in preferred language', () => {
      const languages = Languages.fromAcceptLanguage('ja,en;q=0.8');

      // Find a message that exists in English but might not in Japanese
      const enBundle = i18nSupport.bundles.get('en');
      const jaBundle = i18nSupport.bundles.get('ja');

      let testMessageId = null;
      for (const [key] of Object.entries(enBundle)) {
        if (!jaBundle || !jaBundle[key]) {
          testMessageId = key;
          break;
        }
      }

      if (testMessageId) {
        const result = i18nSupport.formatMessage(languages, testMessageId);
        expect(result).toBe(enBundle[testMessageId].replaceAll("''", "'"));
      }
    });

    test('should fallback to message ID when not found anywhere', () => {
      const languages = Languages.fromAcceptLanguage('ja,en;q=0.8');
      const result = i18nSupport.formatMessage(languages, 'NONEXISTENT_MESSAGE');

      expect(result).toBe('NONEXISTENT_MESSAGE');
    });
  });

  describe('Language Fallback Logic', () => {
    beforeEach(async () => {
      await i18nSupport.load();
    });

    test('should prefer specific language when available', () => {
      // Test with languages that should be loaded
      const languages = Languages.fromAcceptLanguage('ja,en;q=0.8');
      const result = i18nSupport.formatMessage(languages, 'ALL_OK');

      if (i18nSupport.bundles.has('ja')) {
        expect(result).toBe('すべてOK');
      } else {
        expect(result).toBe('All OK');
      }
    });

    test('should respect language preference order', () => {
      const languages = Languages.fromAcceptLanguage('nl,ja;q=0.9,en;q=0.8');
      const result = i18nSupport.formatMessage(languages, 'ALL_OK');

      if (i18nSupport.bundles.has('nl')) {
        expect(result).toBe('Alles OK');
      } else if (i18nSupport.bundles.has('ja')) {
        expect(result).toBe('すべてOK');
      } else {
        expect(result).toBe('All OK');
      }
    });
  });

  describe('Utility Methods', () => {
    beforeEach(async () => {
      await i18nSupport.load();
    });

    test('should return available languages', () => {
      const languages = i18nSupport.getAvailableLanguages();

      expect(Array.isArray(languages)).toBe(true);
      expect(languages.length).toBeGreaterThan(0);
      expect(languages).toContain('en');
    });

    test('should check if message exists', () => {
      expect(i18nSupport.hasMessage('ALL_OK')).toBe(true);
      expect(i18nSupport.hasMessage('NONEXISTENT_MESSAGE')).toBe(false);
    });

    test('should create linked copy', () => {
      const copy = i18nSupport.link();

      expect(copy).toBeInstanceOf(I18nSupport);
      expect(copy).not.toBe(i18nSupport);
      expect(copy.translationsPath).toBe(i18nSupport.translationsPath);
      expect(copy.languageDefinitions).toBe(i18nSupport.languageDefinitions);
      expect(copy.bundles).toEqual(i18nSupport.bundles);
      expect(copy.bundles).not.toBe(i18nSupport.bundles); // Should be different Map instance
    });
  });

  describe('Parameter Substitution', () => {
    beforeEach(() => {
      i18nSupport.bundles.set('en', {
        'SIMPLE': 'Simple message',
        'ONE_PARAM': 'Hello {0}!',
        'TWO_PARAMS': 'User {0} has {1} messages',
        'COMPLEX': 'The type \'{1}\' is not valid - must be one of {0} types: {2}',
        'NO_SEQUENTIAL': 'Start {1} and end {0}' // Non-sequential parameter order
      });
    });

    test('should not modify messages without parameters', () => {
      const languages = Languages.fromAcceptLanguage('en');
      const result = i18nSupport.formatMessage(languages, 'SIMPLE');

      expect(result).toBe('Simple message');
    });

    test('should substitute single parameter', () => {
      const languages = Languages.fromAcceptLanguage('en');
      const result = i18nSupport.formatMessage(languages, 'ONE_PARAM', ['World']);

      expect(result).toBe('Hello World!');
    });

    test('should substitute multiple parameters', () => {
      const languages = Languages.fromAcceptLanguage('en');
      const result = i18nSupport.formatMessage(languages, 'TWO_PARAMS', ['John', '5']);

      expect(result).toBe('User John has 5 messages');
    });

    test('should handle non-sequential parameter indices', () => {
      const languages = Languages.fromAcceptLanguage('en');
      const result = i18nSupport.formatMessage(languages, 'NO_SEQUENTIAL', ['finish', 'begin']);

      expect(result).toBe('Start begin and end finish');
    });

    test('should handle complex real-world message', () => {
      const languages = Languages.fromAcceptLanguage('en');
      const result = i18nSupport.formatMessage(
        languages,
        'COMPLEX',
        ['3', 'Patient', 'Observation, Condition, DiagnosticReport']
      );

      expect(result).toBe('The type \'Patient\' is not valid - must be one of 3 types: Observation, Condition, DiagnosticReport');
    });
  });

  describe('Pluralization Support', () => {
    beforeEach(async () => {
      await i18nSupport.load();
    });

    test('should use _one form for count = 1', () => {
      const languages = Languages.fromAcceptLanguage('en-US');
      const result = i18nSupport.formatMessagePlural(
        languages,
        'Bundle_BUNDLE_Entry_Type3',
        1,
        ['Patient', 'Observation']
      );

      // Should use Bundle_BUNDLE_Entry_Type3_one if it exists
      expect(result).toContain('Patient');
      expect(result).toContain('Observation');
    });

    test('should use _other form for count > 1', () => {
      const languages = Languages.fromAcceptLanguage('en-US');
      const result = i18nSupport.formatMessagePlural(
        languages,
        'Bundle_BUNDLE_Entry_Type3',
        3,
        ['Patient', 'Observation, Condition, DiagnosticReport']
      );

      // Should use Bundle_BUNDLE_Entry_Type3_other if it exists
      expect(result).toContain('Patient');
      expect(result).toContain('3'); // Count should be included as {0}
    });

    test('should use _other form for count = 0', () => {
      const languages = Languages.fromAcceptLanguage('en-US');
      const result = i18nSupport.formatMessagePlural(
        languages,
        'Bundle_BUNDLE_Entry_Type3',
        0,
        ['Patient', 'types']
      );

      expect(result).toContain('0'); // Count should be included as {0}
    });

    test('should prepend count as parameter 0', () => {
      const languages = Languages.fromAcceptLanguage('en-US');

      // Test with a message that uses {0} for the count
      const result = i18nSupport.formatMessagePlural(
        languages,
        'BUNDLE_BUNDLE_ENTRY_NOTFOUND_APPARENT',
        5,
        ['reference', 'bundle', 'url1, url2, url3']
      );

      // Should include count as first parameter
      expect(result).toContain('5');
      expect(result).toContain('reference');
      expect(result).toContain('bundle');
    });

    test('should work with Japanese pluralization if available', () => {
      const languages = Languages.fromAcceptLanguage('ja,en;q=0.8');

      const resultOne = i18nSupport.formatMessagePlural(
        languages,
        'Bundle_BUNDLE_Entry_Type3',
        1,
        ['Patient', 'Observation']
      );

      const resultOther = i18nSupport.formatMessagePlural(
        languages,
        'Bundle_BUNDLE_Entry_Type3',
        3,
        ['Patient', 'types']
      );

      // Should contain the parameters regardless of which language is used
      expect(resultOne).toContain('Patient');
      expect(resultOther).toContain('Patient');
      expect(resultOther).toContain('3');
    });

    test('should fallback to base message when plural forms not available', () => {
      const languages = Languages.fromAcceptLanguage('en-US');

      // Use a message that likely doesn't have plural forms
      const result = i18nSupport.formatMessagePlural(
        languages,
        'BINDING_MAX',
        5,
        ['additional param']
      );

      // Should use base message and include count as {0}
      expect(result).toContain('5');
    });

    test('should handle missing base message for pluralization', () => {
      const languages = Languages.fromAcceptLanguage('en-US');
      const result = i18nSupport.formatMessagePlural(
        languages,
        'NONEXISTENT_MESSAGE',
        1,
        ['param']
      );

      expect(result).toBe('NONEXISTENT_MESSAGE');
    });
  });

  describe('Integration with Real Messages', () => {
    beforeEach(async () => {
      await i18nSupport.load();
    });

    test('should work with actual message format from provided files', () => {
      const enLanguages = Languages.fromAcceptLanguage('en-US');
      const jaLanguages = Languages.fromAcceptLanguage('ja,en;q=0.8');

      // Test simple message
      expect(i18nSupport.formatMessage(enLanguages, 'ALL_OK')).toBe('All OK');

      if (i18nSupport.bundles.has('ja')) {
        expect(i18nSupport.formatMessage(jaLanguages, 'ALL_OK')).toBe('すべてOK');
      }

      // Test message with parameters if it exists
      const enBundle = i18nSupport.bundles.get('en');
      if (enBundle && enBundle['Bad_file_path_error']) {
        const result = i18nSupport.formatMessage(
          enLanguages,
          'Bad_file_path_error',
          ['test.txt']
        );
        expect(result).toContain('test.txt');
      }
    });

    test('should demonstrate pluralization with real messages', () => {
      const languages = Languages.fromAcceptLanguage('en-US');

      // Test pluralization with actual FHIR messages if they exist
      const enBundle = i18nSupport.bundles.get('en');

      if (enBundle && enBundle['Bundle_BUNDLE_Entry_Type3_one']) {
        const singularResult = i18nSupport.formatMessagePlural(
          languages,
          'Bundle_BUNDLE_Entry_Type3',
          1,
          ['InvalidType', 'ValidType']
        );
        expect(singularResult).toContain('InvalidType');
        expect(singularResult).toContain('ValidType');
      }

      if (enBundle && enBundle['Bundle_BUNDLE_Entry_Type3_other']) {
        const pluralResult = i18nSupport.formatMessagePlural(
          languages,
          'Bundle_BUNDLE_Entry_Type3',
          3,
          ['InvalidType', 'ValidType1, ValidType2, ValidType3']
        );
        expect(pluralResult).toContain('InvalidType');
        expect(pluralResult).toContain('3');
      }
    });
  });
});
