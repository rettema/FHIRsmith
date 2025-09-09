const { OperationContext, OperationParameters, ExpansionParamsVersionRuleMode, TerminologyError, TooCostlyError, TimeTracker } = require('../../tx/operation-context');
const { Languages, LanguageDefinitions } = require('../../library/languages');

describe('TimeTracker', () => {
  let timeTracker;

  beforeEach(() => {
    timeTracker = new TimeTracker();
  });

  test('should initialize with start time and empty steps', () => {
    expect(timeTracker.steps).toEqual([]);
    expect(timeTracker.startTime).toBeDefined();
    expect(typeof timeTracker.startTime).toBe('number');
  });

  test('should record steps with elapsed time', (done) => {
    timeTracker.step('first step');

    setTimeout(() => {
      timeTracker.step('second step');

      expect(timeTracker.steps).toHaveLength(2);
      expect(timeTracker.steps[0]).toMatch(/^\d+ms first step$/);
      expect(timeTracker.steps[1]).toMatch(/^\d+ms second step$/);

      // Second step should have higher elapsed time
      const firstElapsed = parseInt(timeTracker.steps[0].match(/(\d+)ms/)[1]);
      const secondElapsed = parseInt(timeTracker.steps[1].match(/(\d+)ms/)[1]);
      expect(secondElapsed).toBeGreaterThanOrEqual(firstElapsed);

      done();
    }, 10);
  });

  test('should return formatted log', () => {
    timeTracker.step('step 1');
    timeTracker.step('step 2');

    const log = timeTracker.log();
    expect(log).toContain('step 1');
    expect(log).toContain('step 2');
    expect(log).toContain('\n');
  });

  test('should create linked copy', () => {
    timeTracker.step('original step');
    const linked = timeTracker.link();

    expect(linked).toBeInstanceOf(TimeTracker);
    expect(linked.startTime).toBe(timeTracker.startTime);
    expect(linked.steps).toEqual(timeTracker.steps);
    expect(linked.steps).not.toBe(timeTracker.steps); // Should be copy, not reference
  });
});

describe('OperationParameters', () => {
  let mockLanguageDefinitions;

  beforeEach(() => {
    mockLanguageDefinitions = new LanguageDefinitions();
  });

  describe('Constructor', () => {
    test('should initialize with default values', () => {
      const params = new OperationParameters(mockLanguageDefinitions);

      expect(params.languageDefinitions).toBe(mockLanguageDefinitions);
      expect(params.versionRules).toEqual([]);
      expect(params.valueSetVersionRules).toEqual([]);
      expect(params.properties).toEqual([]);
      expect(params.designations).toEqual([]);
      expect(params.uid).toBe('');

      // Default boolean values
      expect(params.activeOnly).toBe(false);
      expect(params.excludeNested).toBe(false);
      expect(params.generateNarrative).toBe(true); // Default to true
      expect(params.limitedExpansion).toBe(false);
      expect(params.excludeNotForUI).toBe(false);
      expect(params.excludePostCoordinated).toBe(false);
      expect(params.includeDesignations).toBe(false);
      expect(params.includeDefinition).toBe(false);
      expect(params.membershipOnly).toBe(false);
      expect(params.defaultToLatestVersion).toBe(false);
      expect(params.incompleteOK).toBe(false);
      expect(params.displayWarning).toBe(false);
      expect(params.diagnostics).toBe(false);

      // Has flags should all be false initially
      expect(params.hasActiveOnly).toBe(false);
      expect(params.hasExcludeNested).toBe(false);
      expect(params.hasGenerateNarrative).toBe(false);
      expect(params.hasLimitedExpansion).toBe(false);
      expect(params.hasExcludeNotForUI).toBe(false);
      expect(params.hasExcludePostCoordinated).toBe(false);
      expect(params.hasIncludeDesignations).toBe(false);
      expect(params.hasIncludeDefinition).toBe(false);
      expect(params.hasMembershipOnly).toBe(false);
      expect(params.hasDefaultToLatestVersion).toBe(false);
      expect(params.hasIncompleteOK).toBe(false);
      expect(params.hasDisplayWarning).toBe(false);

      expect(params.hasHttpLanguages).toBe(false);
      expect(params.hasDisplayLanguages).toBe(false);
      expect(params.hasDesignations).toBe(false);
    });

    test('should create default profile', () => {
      const params = OperationParameters.defaultProfile(mockLanguageDefinitions);

      expect(params).toBeInstanceOf(OperationParameters);
      expect(params.languageDefinitions).toBe(mockLanguageDefinitions);
    });
  });

  describe('Property Tracking', () => {
    let params;

    beforeEach(() => {
      params = new OperationParameters(mockLanguageDefinitions);
    });

    test('should track when boolean properties are set', () => {
      expect(params.hasActiveOnly).toBe(false);

      params.activeOnly = true;

      expect(params.activeOnly).toBe(true);
      expect(params.hasActiveOnly).toBe(true);
    });

    test('should track all boolean properties independently', () => {
      params.excludeNested = true;
      params.includeDefinition = false;
      params.membershipOnly = true;

      expect(params.hasExcludeNested).toBe(true);
      expect(params.hasIncludeDefinition).toBe(true);
      expect(params.hasMembershipOnly).toBe(true);
      expect(params.hasActiveOnly).toBe(false); // Not set

      expect(params.excludeNested).toBe(true);
      expect(params.includeDefinition).toBe(false);
      expect(params.membershipOnly).toBe(true);
    });

    test('should track language properties', () => {
      expect(params.hasHttpLanguages).toBe(false);
      expect(params.hasDisplayLanguages).toBe(false);

      params.httpLanguages = Languages.fromAcceptLanguage('en-US');
      params.displayLanguages = Languages.fromAcceptLanguage('fr-FR');

      expect(params.hasHttpLanguages).toBe(true);
      expect(params.hasDisplayLanguages).toBe(true);
    });

    test('should track designations', () => {
      expect(params.hasDesignations).toBe(false);

      params.designations.push('designation1');

      expect(params.hasDesignations).toBe(true);
    });
  });

  describe('Version Rules', () => {
    let params;

    beforeEach(() => {
      params = new OperationParameters(mockLanguageDefinitions);
    });

    test('should add version rules', () => {
      params.addVersionRule('http://example.com/system', '1.0', ExpansionParamsVersionRuleMode.CHECK);

      expect(params.versionRules).toHaveLength(1);
      expect(params.versionRules[0]).toEqual({
        system: 'http://example.com/system',
        version: '1.0',
        mode: ExpansionParamsVersionRuleMode.CHECK
      });
    });

    test('should use default mode when not specified', () => {
      params.addVersionRule('http://example.com/system', '1.0');

      expect(params.versionRules[0].mode).toBe(ExpansionParamsVersionRuleMode.DEFAULT);
    });

    test('should get version for rule', () => {
      params.addVersionRule('system1', '1.0', ExpansionParamsVersionRuleMode.CHECK);
      params.addVersionRule('system2', '2.0', ExpansionParamsVersionRuleMode.OVERRIDE);
      params.addVersionRule('system1', '1.5', ExpansionParamsVersionRuleMode.OVERRIDE);

      expect(params.getVersionForRule('system1', ExpansionParamsVersionRuleMode.CHECK)).toBe('1.0');
      expect(params.getVersionForRule('system1', ExpansionParamsVersionRuleMode.OVERRIDE)).toBe('1.5');
      expect(params.getVersionForRule('system2', ExpansionParamsVersionRuleMode.OVERRIDE)).toBe('2.0');
      expect(params.getVersionForRule('system3', ExpansionParamsVersionRuleMode.CHECK)).toBe('');
    });

    test('should parse version rule from URL format', () => {
      params.seeVersionRule('http://example.com/system|1.0', ExpansionParamsVersionRuleMode.CHECK);

      expect(params.versionRules).toHaveLength(1);
      expect(params.versionRules[0]).toEqual({
        system: 'http://example.com/system',
        version: '1.0',
        mode: ExpansionParamsVersionRuleMode.CHECK
      });
    });

    test('should throw error for invalid version rule format', () => {
      expect(() => {
        params.seeVersionRule('invalid-format', ExpansionParamsVersionRuleMode.CHECK);
      }).toThrow(TerminologyError);

      expect(() => {
        params.seeVersionRule('too|many|parts', ExpansionParamsVersionRuleMode.OVERRIDE);
      }).toThrow(TerminologyError);
    });
  });

  describe('Language Support', () => {
    let params;

    beforeEach(() => {
      params = new OperationParameters(mockLanguageDefinitions);
    });

    test('should set and get working languages', () => {
      const httpLangs = Languages.fromAcceptLanguage('en-US,fr;q=0.8');
      const displayLangs = Languages.fromAcceptLanguage('de-DE');

      params.httpLanguages = httpLangs;
      expect(params.workingLanguages).toBe(httpLangs);

      params.displayLanguages = displayLangs;
      expect(params.workingLanguages).toBe(displayLangs); // Display takes precedence
    });

    test('should generate language summary', () => {
      expect(params.langSummary).toBe('--');

      params.httpLanguages = Languages.fromAcceptLanguage('en-US');
      expect(params.langSummary).toBe('en-US');

      params.displayLanguages = Languages.fromAcceptLanguage('fr-FR');
      expect(params.langSummary).toBe('fr-FR'); // Display takes precedence
    });
  });

  describe('Parameter Processing', () => {
    let params;

    beforeEach(() => {
      params = new OperationParameters(mockLanguageDefinitions);
    });

    test('should process displayLanguage parameter', () => {
      params.seeParameter('displayLanguage', 'fr-FR,en;q=0.9');

      expect(params.hasDisplayLanguages).toBe(true);
      expect(params.displayLanguages.getPrimary().code).toBe('fr-FR');
    });

    test('should process designation parameter', () => {
      params.seeParameter('designation', 'designation1');
      params.seeParameter('designation', 'designation2');

      expect(params.designations).toEqual(['designation1', 'designation2']);
      expect(params.hasDesignations).toBe(true);
    });

    test('should handle object with primitiveValue', () => {
      const mockObject = {primitiveValue: 'test-value'};
      params.seeParameter('designation', mockObject);

      expect(params.designations).toEqual(['test-value']);
    });

    test('should handle null values', () => {
      params.seeParameter('designation', null);

      expect(params.designations).toEqual([]);
    });

    test('should respect overwrite flag for displayLanguage', () => {
      params.httpLanguages = Languages.fromAcceptLanguage('en-US');

      // Should not overwrite when httpLanguages exists and overwrite is false
      params.seeParameter('displayLanguage', 'fr-FR', false);
      expect(params.hasDisplayLanguages).toBe(false);

      // Should overwrite when overwrite is true
      params.seeParameter('displayLanguage', 'fr-FR', true);
      expect(params.hasDisplayLanguages).toBe(true);
      expect(params.displayLanguages.getPrimary().code).toBe('fr-FR');
    });
  });

  describe('Value Set Version Rules', () => {
    let params;

    beforeEach(() => {
      params = new OperationParameters(mockLanguageDefinitions);
    });

    test('should initially have no value set version rules', () => {
      expect(params.hasValueSetVersionRules).toBe(false);
      expect(params.getValueSetVersionRules()).toEqual([]);
    });

    test('should track value set version rules', () => {
      params.valueSetVersionRules.push('rule1');

      expect(params.hasValueSetVersionRules).toBe(true);
      expect(params.getValueSetVersionRules()).toEqual(['rule1']);
    });
  });

  describe('Summary Generation', () => {
    let params;

    beforeEach(() => {
      params = new OperationParameters(mockLanguageDefinitions);
    });

    test('should generate empty summary for default parameters', () => {
      const summary = params.summary();

      expect(summary).toBe('generate-narrative'); // Only true by default
    });

    test('should include uid and properties in summary', () => {
      params.uid = 'test-uid';
      params.properties.push('prop1', 'prop2');

      const summary = params.summary();

      expect(summary).toContain('uid=test-uid');
      expect(summary).toContain('properties=prop1,prop2');
    });

    test('should include boolean flags when true', () => {
      params.activeOnly = true;
      params.excludeNested = true;
      params.includeDefinition = true;

      const summary = params.summary();

      expect(summary).toContain('active-only');
      expect(summary).toContain('exclude-nested');
      expect(summary).toContain('include-definition');
      expect(summary).toContain('generate-narrative'); // Default true
    });

    test('should include language information', () => {
      params.httpLanguages = Languages.fromAcceptLanguage('en-US');
      params.displayLanguages = Languages.fromAcceptLanguage('fr-FR');
      params.designations.push('designation1');

      const summary = params.summary();

      expect(summary).toContain('http-lang=en-US');
      expect(summary).toContain('disp-lang=fr-FR');
      expect(summary).toContain('designations=designation1');
    });

    test('should generate version summary', () => {
      params.addVersionRule('system1', '1.0', ExpansionParamsVersionRuleMode.CHECK);
      params.addVersionRule('system2', '2.0', ExpansionParamsVersionRuleMode.OVERRIDE);

      const verSummary = params.verSummary;

      expect(verSummary).toContain('system1#1.0/Check');
      expect(verSummary).toContain('system2#2.0/Override');
    });
  });

  describe('Hash Generation', () => {
    let params;

    beforeEach(() => {
      params = new OperationParameters(mockLanguageDefinitions);
    });

    test('should generate consistent hash for same parameters', () => {
      params.uid = 'test-uid';
      params.activeOnly = true;
      params.properties.push('prop1');

      const hash1 = params.hash();
      const hash2 = params.hash();

      expect(hash1).toBe(hash2);
      expect(typeof hash1).toBe('string');
      expect(hash1.length).toBeGreaterThan(0);
    });

    test('should generate different hash for different parameters', () => {
      const params1 = new OperationParameters(mockLanguageDefinitions);
      const params2 = new OperationParameters(mockLanguageDefinitions);

      params1.activeOnly = true;
      params2.excludeNested = true;

      expect(params1.hash()).not.toBe(params2.hash());
    });

    test('should include version rules in hash', () => {
      const hashBefore = params.hash();

      params.addVersionRule('system1', '1.0', ExpansionParamsVersionRuleMode.CHECK);

      const hashAfter = params.hash();

      expect(hashBefore).not.toBe(hashAfter);
    });

    test('should include language settings in hash', () => {
      const hashBefore = params.hash();

      params.httpLanguages = Languages.fromAcceptLanguage('en-US');

      const hashAfter = params.hash();

      expect(hashBefore).not.toBe(hashAfter);
    });
  });

  describe('Clone Functionality', () => {
    let originalParams;

    beforeEach(() => {
      originalParams = new OperationParameters(mockLanguageDefinitions);
      originalParams.uid = 'test-uid';
      originalParams.activeOnly = true;
      originalParams.excludeNested = true;
      originalParams.properties.push('prop1', 'prop2');
      originalParams.designations.push('des1', 'des2');
      originalParams.addVersionRule('system1', '1.0', ExpansionParamsVersionRuleMode.CHECK);
      originalParams.httpLanguages = Languages.fromAcceptLanguage('en-US');
      originalParams.displayLanguages = Languages.fromAcceptLanguage('fr-FR');
    });

    test('should create deep copy with same values', () => {
      const copy = originalParams.clone();

      expect(copy).toBeInstanceOf(OperationParameters);
      expect(copy).not.toBe(originalParams);
      expect(copy.languageDefinitions).toBe(originalParams.languageDefinitions);

      expect(copy.uid).toBe(originalParams.uid);
      expect(copy.activeOnly).toBe(originalParams.activeOnly);
      expect(copy.excludeNested).toBe(originalParams.excludeNested);
      expect(copy.hasActiveOnly).toBe(originalParams.hasActiveOnly);
      expect(copy.hasExcludeNested).toBe(originalParams.hasExcludeNested);
    });

    test('should create independent arrays', () => {
      const copy = originalParams.clone();

      expect(copy.properties).toEqual(originalParams.properties);
      expect(copy.properties).not.toBe(originalParams.properties);

      expect(copy.designations).toEqual(originalParams.designations);
      expect(copy.designations).not.toBe(originalParams.designations);

      expect(copy.versionRules).toEqual(originalParams.versionRules);
      expect(copy.versionRules).not.toBe(originalParams.versionRules);

      // Modify copy - shouldn't affect original
      copy.properties.push('new-prop');
      expect(originalParams.properties).not.toContain('new-prop');
    });

    test('should create independent version rule objects', () => {
      const copy = originalParams.clone();

      // Modify copy's version rule - shouldn't affect original
      copy.versionRules[0].version = '2.0';
      expect(originalParams.versionRules[0].version).toBe('1.0');
    });

    test('should create independent language objects', () => {
      const copy = originalParams.clone();

      expect(copy.httpLanguages).not.toBe(originalParams.httpLanguages);
      expect(copy.displayLanguages).not.toBe(originalParams.displayLanguages);

      // Should have same language codes
      expect(copy.httpLanguages.getPrimary().code).toBe('en-US');
      expect(copy.displayLanguages.getPrimary().code).toBe('fr-FR');
    });
  });

  describe('Edge Cases', () => {
    let params;

    beforeEach(() => {
      params = new OperationParameters(mockLanguageDefinitions);
    });

    test('should handle empty version rule parsing', () => {
      expect(() => {
        params.seeVersionRule('', ExpansionParamsVersionRuleMode.CHECK);
      }).toThrow(TerminologyError);
    });

    test('should handle version rule with empty parts', () => {
      expect(() => {
        params.seeVersionRule('system|', ExpansionParamsVersionRuleMode.CHECK);
      }).not.toThrow();

      expect(params.versionRules[0]).toEqual({
        system: 'system',
        version: '',
        mode: ExpansionParamsVersionRuleMode.CHECK
      });
    });

    test('should return empty string for non-existent version rule', () => {
      const version = params.getVersionForRule('non-existent', ExpansionParamsVersionRuleMode.CHECK);
      expect(version).toBe('');
    });

    test('should handle null languages in working languages', () => {
      expect(params.workingLanguages).toBe(null);

      params.httpLanguages = Languages.fromAcceptLanguage('en-US');
      expect(params.workingLanguages).toBe(params.httpLanguages);
    });

    test('should generate consistent hash for complex parameters', () => {
      params.uid = 'complex-uid';
      params.activeOnly = true;
      params.excludeNested = false;
      params.includeDefinition = true;
      params.properties.push('prop1', 'prop2', 'prop3');
      params.designations.push('des1');
      params.addVersionRule('sys1', '1.0', ExpansionParamsVersionRuleMode.CHECK);
      params.addVersionRule('sys2', '2.0', ExpansionParamsVersionRuleMode.OVERRIDE);
      params.httpLanguages = Languages.fromAcceptLanguage('en-US,fr;q=0.8');

      const hash1 = params.hash();
      const hash2 = params.hash();

      expect(hash1).toBe(hash2);
      expect(hash1).toMatch(/^\d+$/); // Should be numeric string
    });
  });

  describe('OperationContext', () => {
    describe('Constructor', () => {
      test('should initialize with string language parameter', () => {
        const context = new OperationContext('en-US');

        expect(context.langs).toBeInstanceOf(Languages);
        expect(context.langs.getPrimary().code).toBe('en-US');
        expect(context.id).toBeDefined();
        expect(context.id).toMatch(/^op_[a-z0-9]+_\d+$/);
        expect(context.timeLimit).toBe(30000); // 30 seconds in ms
        expect(context.contexts).toEqual([]);
        expect(context.logEntries).toEqual([]);
      });

      test('should initialize with Languages object', () => {
        const langObj = Languages.fromAcceptLanguage('fr-FR,en;q=0.9');
        const context = new OperationContext(langObj);

        expect(context.langs).toBe(langObj);
        expect(context.langs.getPrimary().code).toBe('fr-FR');
      });

      test('should accept custom id and timeLimit', () => {
        const context = new OperationContext('en-US', 'custom-id', 60);

        expect(context.id).toBe('custom-id');
        expect(context.timeLimit).toBe(60000); // 60 seconds in ms
      });

      test('should throw assertion error for invalid language parameter', () => {
        expect(() => new OperationContext(123)).toThrow();
        expect(() => new OperationContext(null)).toThrow();
        expect(() => new OperationContext(undefined)).toThrow();
      });

      test('should initialize timeTracker with initial step', () => {
        const context = new OperationContext('en-US');

        expect(context.timeTracker.steps).toHaveLength(1);
        expect(context.timeTracker.steps[0]).toMatch(/^\d+ms tx-op$/);
      });
    });

    describe('ID Generation', () => {
      test('should generate unique IDs', () => {
        const context1 = new OperationContext('en-US');
        const context2 = new OperationContext('en-US');

        expect(context1.id).not.toBe(context2.id);
        expect(context1.reqId).toBe(context1.id);
        expect(context2.reqId).toBe(context2.id);
      });
    });

    describe('Context Tracking', () => {
      let context;

      beforeEach(() => {
        context = new OperationContext('en-US');
      });

      test('should track context URLs', () => {
        context.seeContext('http://example.com/vs1');
        context.seeContext('http://example.com/vs2');

        expect(context.contexts).toEqual([
          'http://example.com/vs1',
          'http://example.com/vs2'
        ]);
      });

      test('should throw TerminologyError on circular reference', () => {
        context.seeContext('http://example.com/vs1');
        context.seeContext('http://example.com/vs2');

        expect(() => {
          context.seeContext('http://example.com/vs1');
        }).toThrow(TerminologyError);

        try {
          context.seeContext('http://example.com/vs1');
        } catch (error) {
          expect(error.message).toContain('Circular reference detected');
          expect(error.message).toContain('http://example.com/vs1');
          expect(error.message).toContain('[http://example.com/vs1, http://example.com/vs2]');
        }
      });

      test('should clear contexts', () => {
        context.seeContext('http://example.com/vs1');
        context.seeContext('http://example.com/vs2');

        context.clearContexts();

        expect(context.contexts).toEqual([]);

        // Should be able to add same URL again after clearing
        expect(() => {
          context.seeContext('http://example.com/vs1');
        }).not.toThrow();
      });
    });

    describe('Logging', () => {
      let context;

      beforeEach(() => {
        context = new OperationContext('en-US');
      });

      test('should log messages with timestamps', () => {
        context.log('test message');

        expect(context.logEntries).toHaveLength(1);
        expect(context.logEntries[0]).toMatch(/^\d+ms test message$/);
      });

      test('should log multiple messages', (done) => {
        context.log('first message');

        setTimeout(() => {
          context.log('second message');

          expect(context.logEntries).toHaveLength(2);

          const firstTime = parseInt(context.logEntries[0].match(/(\d+)ms/)[1]);
          const secondTime = parseInt(context.logEntries[1].match(/(\d+)ms/)[1]);

          expect(secondTime).toBeGreaterThanOrEqual(firstTime);
          done();
        }, 10);
      });

      test('should add value set notes', () => {
        const mockValueSet = {vurl: 'http://example.com/vs1'};

        context.addNote(mockValueSet, 'processing valueset');

        expect(context.logEntries).toHaveLength(1);
        expect(context.logEntries[0]).toMatch(/^\d+ms http:\/\/example\.com\/vs1: processing valueset$/);
      });

      test('should handle value set without vurl', () => {
        const mockValueSet = {};

        context.addNote(mockValueSet, 'processing valueset');

        expect(context.logEntries[0]).toMatch(/^\d+ms unknown-valueset: processing valueset$/);
      });

      test('should handle null value set', () => {
        context.addNote(null, 'processing valueset');

        expect(context.logEntries[0]).toMatch(/^\d+ms unknown-valueset: processing valueset$/);
      });
    });

    describe('Dead Check', () => {
      test('should not throw error within time limit', () => {
        const context = new OperationContext('en-US', 'test-id', 1); // 1 second limit

        expect(() => {
          context.deadCheck('test location');
        }).not.toThrow();
      });

      test('should throw TooCostlyError when time limit exceeded', (done) => {
        const context = new OperationContext('en-US', 'test-id', 0.01); // 10ms limit

        setTimeout(() => {
          expect(() => {
            context.deadCheck('test location');
          }).toThrow(TooCostlyError);

          try {
            context.deadCheck('test location');
          } catch (error) {
            expect(error.name).toBe('TooCostlyError');
            expect(error.message).toContain('exceeded time limit');
            expect(error.message).toContain('test location');
            expect(error.diagnostics).toBeDefined();
            expect(typeof error.diagnostics).toBe('string');
          }

          done();
        }, 50); // Wait longer than the 10ms limit
      });

      test('should add log entry when time limit exceeded', (done) => {
        const context = new OperationContext('en-US', 'test-id', 0.01); // 10ms limit

        setTimeout(() => {
          try {
            context.deadCheck('test location');
          } catch (error) {
            // Should have logged the timeout
            const hasTimeoutLog = context.logEntries.some(entry =>
              entry.includes('Operation took too long @ test location')
            );
            expect(hasTimeoutLog).toBe(true);
          }

          done();
        }, 50);
      });

      test('should return false when within time limit', () => {
        const context = new OperationContext('en-US', 'test-id', 1); // 1 second limit

        const result = context.deadCheck('test location');
        expect(result).toBe(false);
      });
    });

    describe('Copy Functionality', () => {
      let originalContext;

      beforeEach(() => {
        originalContext = new OperationContext('en-US', 'original-id', 45);
        originalContext.seeContext('http://example.com/vs1');
        originalContext.log('original log entry');
      });

      test('should create copy with same properties', () => {
        const copy = originalContext.copy();

        expect(copy).toBeInstanceOf(OperationContext);
        expect(copy.id).toBe(originalContext.id);
        expect(copy.timeLimit).toBe(originalContext.timeLimit);
        expect(copy.langs).toBe(originalContext.langs);
      });

      test('should copy contexts array', () => {
        const copy = originalContext.copy();

        expect(copy.contexts).toEqual(originalContext.contexts);
        expect(copy.contexts).not.toBe(originalContext.contexts); // Should be different array
      });

      test('should copy log entries', () => {
        const copy = originalContext.copy();

        expect(copy.logEntries).toEqual(originalContext.logEntries);
        expect(copy.logEntries).not.toBe(originalContext.logEntries); // Should be different array
      });

      test('should preserve start time', () => {
        const copy = originalContext.copy();

        expect(copy.startTime).toBe(originalContext.startTime);
      });

      test('should link time tracker', () => {
        const copy = originalContext.copy();

        expect(copy.timeTracker.startTime).toBe(originalContext.timeTracker.startTime);
        expect(copy.timeTracker.steps).toEqual(originalContext.timeTracker.steps);
        expect(copy.timeTracker).not.toBe(originalContext.timeTracker); // Should be different instance
      });
    });

    describe('Diagnostics', () => {
      let context;

      beforeEach(() => {
        context = new OperationContext('en-US');
      });

      test('should return time tracker log', () => {
        context.log('test step 1');
        context.log('test step 2');

        const diagnostics = context.diagnostics();

        expect(typeof diagnostics).toBe('string');
        expect(diagnostics).toContain('tx-op');
        expect(diagnostics).toContain('test step 1');
        expect(diagnostics).toContain('test step 2');
      });
    });

    describe('Edge Cases', () => {
      test('should handle very short time limits', () => {
        const context = new OperationContext('en-US', 'test-id', 0.001); // 1ms limit

        // Should still construct successfully
        expect(context.timeLimit).toBe(1);
      });

      test('should handle empty string contexts', () => {
        const context = new OperationContext('en-US');

        expect(() => {
          context.seeContext('');
          context.seeContext('');
        }).toThrow(TerminologyError);
      });

      test('should handle context clearing after circular reference detection', () => {
        const context = new OperationContext('en-US');

        context.seeContext('url1');

        expect(() => {
          context.seeContext('url1');
        }).toThrow(TerminologyError);

        context.clearContexts();

        // Should work fine after clearing
        expect(() => {
          context.seeContext('url1');
        }).not.toThrow();
      });
    });
  });
});