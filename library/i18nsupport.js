const path = require("path");
const fs = require("fs");
const { getProperties } = require("properties-file");

/**
 * Internationalization support for loading Java properties files
 */
class I18nSupport {
  constructor(translationsPath, languageDefinitions) {
    this.translationsPath = translationsPath;
    this.languageDefinitions = languageDefinitions;
    this.bundles = new Map(); // Cache for loaded message bundles by language code
  }

  /**
   * Load all available message bundles from the translations directory
   */
  async load() {
    // Load default Messages.properties first
    await this._loadBundle('en', 'Messages.properties');

    // Scan for Messages_*.properties files
    try {
      const files = fs.readdirSync(this.translationsPath);
      const messageFiles = files.filter(file =>
        file.startsWith('Messages_') && file.endsWith('.properties')
      );

      for (const file of messageFiles) {
        // Extract language code from filename: Messages_fr_FR.properties -> fr-FR
        const langCode = file
          .substring('Messages_'.length, file.length - '.properties'.length)
          .replace(/_/g, '-');

        await this._loadBundle(langCode, file);
      }
    } catch (error) {
      throw new Error(`Failed to scan translations directory: ${error.message}`);
    }
  }

  /**
   * Load a specific message bundle file
   */
  async _loadBundle(langCode, filename) {
    try {
      const filePath = path.join(this.translationsPath, filename);
      const content = fs.readFileSync(filePath, 'utf8');
      const properties = getProperties(content);

      this.bundles.set(langCode, properties);
    } catch (error) {
      // Don't throw for missing files - just skip them
      console.warn(`Warning: Could not load ${filename}: ${error.message}`);
    }
  }

  /**
   * Format a message with parameter substitution
   * @param {Languages} languages - Languages object with preference order
   * @param {string} messageId - Message key from properties file
   * @param {Array} parameters - Parameters for {0}, {1}, etc. substitution
   * @returns {string} Formatted message
   */
  formatMessage(languages, messageId, parameters = []) {
    // Find the best language bundle that has this message
    const message = this._findMessage(languages, messageId);

    if (!message) {
      return messageId; // Fallback to message ID if not found
    }

    // Substitute parameters {0}, {1}, etc.
    return this._substituteParameters(message.trim(), parameters).replaceAll("''", "'");
  }

  translate(messageId, languages, parameters = []) {
    return this.formatMessage(languages, messageId, parameters);
  }

  translatePlural(count, messageId, languages, parameters = []) {
    return this.formatMessagePlural(languages, messageId, count, parameters);
  }

  /**
   * Format a message with pluralization support
   * @param {Languages} languages - Languages object with preference order
   * @param {string} messageId - Base message key from properties file
   * @param {number} count - Count for pluralization (becomes {0} in final message)
   * @param {Array} parameters - Additional parameters for {1}, {2}, etc. substitution
   * @returns {string} Formatted message
   */
  formatMessagePlural(languages, messageId, count, parameters = []) {
    // Determine plural form suffix
    const pluralSuffix = count === 1 ? '_one' : '_other';
    const pluralMessageId = messageId + pluralSuffix;

    // Try to find the plural-specific message first
    let message = this._findMessage(languages, pluralMessageId);

    // If not found, fall back to the base message
    if (!message) {
      message = this._findMessage(languages, messageId);
    }

    if (!message) {
      return messageId; // Fallback to message ID if not found
    }

    // Prepend count as parameter 0, shift other parameters
    const allParameters = [count.toString(), ...parameters];

    // Substitute parameters {0}, {1}, etc.
    return this._substituteParameters(message, allParameters);
  }

  /**
   * Find message in language bundles with fallback logic
   */
  _findMessage(languages, messageId) {
    // Try each language in preference order
    if (languages) {
      for (const language of languages) {
        const message = this._getMessageForLanguage(language.code, messageId);
        if (message) {
          return message;
        }

        // Try language without region (e.g., 'fr' for 'fr-FR')
        if (language.language && language.language !== language.code) {
          const message = this._getMessageForLanguage(language.language, messageId);
          if (message) {
            return message;
          }
        }
      }
    }

    // Final fallback to English
    return this._getMessageForLanguage('en', messageId);
  }

  /**
   * Get message for specific language code
   */
  _getMessageForLanguage(langCode, messageId) {
    const bundle = this.bundles.get(langCode);
    return bundle ? bundle[messageId] : null;
  }

  /**
   * Substitute parameters in message string
   * Replaces {0}, {1}, etc. with provided parameters
   */
  _substituteParameters(message, parameters) {
    if (!parameters || parameters.length === 0) {
      return message;
    }

    return message.replace(/\{(\d+)\}/g, (match, index) => {
      const paramIndex = parseInt(index);
      return paramIndex < parameters.length ? parameters[paramIndex] : match;
    });
  }

  /**
   * Get all available language codes
   */
  getAvailableLanguages() {
    return Array.from(this.bundles.keys());
  }

  /**
   * Check if a message exists for any language
   */
  hasMessage(messageId) {
    for (const bundle of this.bundles.values()) {
      if (bundle[messageId]) {
        return true;
      }
    }
    return false;
  }

  /**
   * Create a linked copy of this I18nSupport instance
   */
  link() {
    const copy = new I18nSupport(this.translationsPath, this.languageDefinitions);
    copy.bundles = new Map(this.bundles); // Shallow copy of bundles map
    return copy;
  }
}

module.exports = {
  I18nSupport
};