//
// FHIR XML Base Class
// Common functionality for all FHIR resource XML serialization/deserialization
//

/**
 * Base class for FHIR XML serialization/deserialization
 * Contains shared methods for converting between FHIR JSON and XML formats
 */
class FhirXmlBase {

  /**
   * FHIR elements that should always be arrays in JSON
   * These are elements that are arrays at the TOP LEVEL of resources or in unambiguous contexts
   * @type {Set<string>}
   */
  static _arrayElements = new Set([
    // Common resource elements
    'identifier',
    'contact',
    'useContext',
    'jurisdiction',
    'extension',
    'modifierExtension',

    // CodeSystem elements (at resource level)
    'concept',       // CodeSystem.concept is array
    'filter',        // CodeSystem.filter is array (but ValueSet.compose.include.filter is also array)
    'operator',      // CodeSystem.filter.operator is array
    'designation',   // concept.designation is array

    // ValueSet elements
    'include',
    'exclude',
    'contains',
    'parameter',
    'valueSet',

    // ConceptMap elements
    'group',
    'element',
    'target',
    'dependsOn',
    'product',
    'additionalAttribute',

    // OperationOutcome elements
    'issue',
    'location',
    'expression',

    // Parameters elements
    'part',

    // Common data type elements
    'coding',
    'telecom',
    'address',
    'given',
    'prefix',
    'suffix',
    'line',
    'link',
    'entry',

    // NamingSystem elements
    'uniqueId',
  ]);

  /**
   * Elements that are arrays ONLY at resource/backbone level, not inside filters/other contexts
   * 'property' is an array in CodeSystem.property and CodeSystem.concept.property
   * but NOT in ValueSet.compose.include.filter.property (which is a single code)
   * @type {Set<string>}
   */
  static _resourceLevelArrayElements = new Set([
    'property',  // Array in CodeSystem.property and concept.property, but single in filter
  ]);

  /**
   * Element names that represent boolean types in FHIR
   * @type {Set<string>}
   */
  static _booleanElements = new Set([
    'valueBoolean',
    'experimental',
    'caseSensitive',
    'compositional',
    'versionNeeded',
    'inactive',
    'notSelectable',
    'abstract',
    'immutable',
    'lockedDate',
    'preferred',
  ]);

  /**
   * Element names that represent integer types in FHIR
   * @type {Set<string>}
   */
  static _integerElements = new Set([
    'valueInteger',
    'valueUnsignedInt',
    'valuePositiveInt',
    'count',
    'offset',
    'total',
  ]);

  /**
   * Element names that represent decimal types in FHIR
   * @type {Set<string>}
   */
  static _decimalElements = new Set([
    'valueDecimal',
  ]);

  // ==================== XML PARSING (XML -> JSON) ====================

  /**
   * Convert a manually parsed XML element to FHIR JSON format
   * @param {Object} element - Element with {name, attributes, children}
   * @param {string} resourceType - The FHIR resource type
   * @returns {Object} FHIR JSON object
   */
  static convertElementToFhirJson(element, resourceType) {
    const result = { resourceType };

    for (const child of element.children) {
      const key = child.name;
      const { value, primitiveExt } = this._convertChildElementWithExt(child, resourceType);

      // Handle the value
      if (value !== null) {
        if (this._isArrayElement(key, resourceType)) {
          if (!result[key]) {
            result[key] = [];
          }
          result[key].push(value);
        } else {
          result[key] = value;
        }
      }

      // Handle primitive extension (e.g., _value with extension)
      if (primitiveExt !== null) {
        const extKey = '_' + key;
        result[extKey] = primitiveExt;
      }
    }

    return result;
  }

  /**
   * Check if an element should be an array based on its name and parent context
   * @param {string} elementName - The element name
   * @param {string} parentContext - The parent element name or context
   * @returns {boolean}
   */
  static _isArrayElement(elementName, parentContext) {
    // These are always arrays regardless of context
    if (this._arrayElements.has(elementName)) {
      return true;
    }

    // 'property' is an array in CodeSystem.property, CodeSystem.concept.property
    // but NOT in filter.property (which is a single code)
    if (elementName === 'property') {
      // property is array at resource level or inside concept, but not inside filter
      return parentContext !== 'filter';
    }

    return false;
  }

  /**
   * Converts a child element to appropriate JSON value, also handling primitive extensions
   * @param {Object} child - Child element with {name, attributes, children}
   * @param {string} parentContext - Parent element name for context-dependent array handling
   * @returns {{value: *, primitiveExt: Object|null}} Converted value and primitive extension if any
   * @private
   */
  // eslint-disable-next-line no-unused-vars
  static _convertChildElementWithExt(child, parentContext = '') {
    const hasValue = child.attributes.value !== undefined;
    const hasChildren = child.children.length > 0;
    const isExtensionElement = child.name === 'extension' || child.name === 'modifierExtension';

    // Extension elements are NEVER primitive extensions - they are always complex elements
    // Only primitive FHIR elements (like string, code, uri, etc.) can have primitive extensions
    if (!isExtensionElement) {
      // Check if children are only extensions (for primitive extension detection)
      const extensionChildren = child.children.filter(
        c => c.name === 'extension' || c.name === 'modifierExtension'
      );
      const nonExtensionChildren = child.children.filter(
        c => c.name !== 'extension' && c.name !== 'modifierExtension'
      );
      const hasOnlyExtensions = hasChildren && nonExtensionChildren.length === 0;

      // Case 1: Simple primitive with value, no children
      if (hasValue && !hasChildren) {
        return { value: this._convertPrimitiveValue(child.name, child.attributes.value), primitiveExt: null };
      }

      // Case 2: Primitive with extension but no value - this is a primitive extension only
      // This ONLY applies when there are NO non-extension children
      if (!hasValue && hasOnlyExtensions) {
        const ext = this._buildExtensionObject(extensionChildren);
        return { value: null, primitiveExt: ext };
      }

      // Case 3: Primitive with both value and extensions (no other children)
      // This ONLY applies when there are NO non-extension children
      if (hasValue && hasOnlyExtensions) {
        const ext = this._buildExtensionObject(extensionChildren);
        return { value: this._convertPrimitiveValue(child.name, child.attributes.value), primitiveExt: ext };
      }
    }

    // Case 4: Complex element - process normally (includes extensions as regular children)
    const obj = {};
    const currentContext = child.name; // Use current element name as context for children

    // Copy non-value attributes (like url for extensions)
    for (const [attrName, attrValue] of Object.entries(child.attributes)) {
      if (attrName !== 'value' && attrName !== 'xmlns') {
        obj[attrName] = attrValue;
      }
    }

    // Process ALL children (including extensions as normal array elements)
    for (const grandchild of child.children) {
      const key = grandchild.name;
      const { value, primitiveExt } = this._convertChildElementWithExt(grandchild, currentContext);

      // Handle the value
      if (value !== null) {
        if (this._isArrayElement(key, currentContext)) {
          if (!obj[key]) {
            obj[key] = [];
          }
          obj[key].push(value);
        } else if (obj[key] !== undefined) {
          // Convert to array if we see the same key twice
          if (!Array.isArray(obj[key])) {
            obj[key] = [obj[key]];
          }
          obj[key].push(value);
        } else {
          obj[key] = value;
        }
      }

      // Handle primitive extension
      if (primitiveExt !== null) {
        const extKey = '_' + key;
        obj[extKey] = primitiveExt;
      }
    }

    return { value: Object.keys(obj).length > 0 ? obj : null, primitiveExt: null };
  }

  /**
   * Build an extension object from extension children
   * @param {Array} extensionChildren - Array of extension child elements
   * @returns {Object} Extension object with extension/modifierExtension arrays
   * @private
   */
  static _buildExtensionObject(extensionChildren) {
    const ext = {};
    for (const extChild of extensionChildren) {
      const key = extChild.name;
      const { value } = this._convertChildElementWithExt(extChild);
      if (!ext[key]) {
        ext[key] = [];
      }
      ext[key].push(value);
    }
    return ext;
  }

  /**
   * Convert a primitive value to the appropriate JavaScript type
   * @param {string} elementName - The element name
   * @param {string} value - The string value from XML
   * @returns {*} Converted value
   * @private
   */
  static _convertPrimitiveValue(elementName, value) {
    if (this._booleanElements.has(elementName)) {
      return value === 'true';
    }
    if (this._integerElements.has(elementName)) {
      return parseInt(value, 10);
    }
    if (this._decimalElements.has(elementName)) {
      return parseFloat(value);
    }
    // Everything else stays as string
    return value;
  }

  /**
   * Simple child element conversion (without tracking primitive extensions)
   * @param {Object} child - Child element with {name, attributes, children}
   * @param {string} parentContext - Parent context for array handling
   * @returns {*} Converted value
   */
  static convertChildElement(child, parentContext = '') {
    return this._convertChildElementWithExt(child, parentContext).value;
  }

  // ==================== XML GENERATION (JSON -> XML) ====================

  /**
   * Get the FHIR namespace
   * @returns {string}
   */
  static getNamespace() {
    return 'http://hl7.org/fhir';
  }

  /**
   * Get indentation string
   * @param {number} level - Indentation level
   * @returns {string}
   */
  static indent(level) {
    return '  '.repeat(level);
  }

  /**
   * Escape special characters for XML
   * @param {*} value - Value to escape
   * @returns {string}
   */
  static escapeXml(value) {
    if (value === null || value === undefined) return '';
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  /**
   * Unescape XML entities
   * @param {string} str - String to unescape
   * @returns {string}
   */
  static unescapeXml(str) {
    return str
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'");
  }

  /**
   * Render an element to XML
   * @param {string} name - Element name
   * @param {*} value - Element value
   * @param {number} level - Indentation level
   * @returns {string} XML string
   */
  static renderElement(name, value, level) {
    if (value === null || value === undefined) {
      return '';
    }

    let xml = '';

    if (Array.isArray(value)) {
      for (const item of value) {
        xml += this.renderElement(name, item, level);
      }
    } else if (typeof value === 'object') {
      // Special handling for extension - url is an attribute
      if (name === 'extension' || name === 'modifierExtension') {
        const url = value.url ? ` url="${this.escapeXml(value.url)}"` : '';
        xml += `${this.indent(level)}<${name}${url}>\n`;
        xml += this.renderObject(value, level + 1, ['url']);
        xml += `${this.indent(level)}</${name}>\n`;
      } else {
        xml += `${this.indent(level)}<${name}>\n`;
        xml += this.renderObject(value, level + 1);
        xml += `${this.indent(level)}</${name}>\n`;
      }
    } else if (typeof value === 'boolean' || typeof value === 'number') {
      xml += `${this.indent(level)}<${name} value="${value}"/>\n`;
    } else {
      xml += `${this.indent(level)}<${name} value="${this.escapeXml(value)}"/>\n`;
    }

    return xml;
  }

  /**
   * Render an object's properties to XML
   * @param {Object} obj - Object to render
   * @param {number} level - Indentation level
   * @param {Array<string>} skipKeys - Keys to skip
   * @returns {string} XML string
   */
  static renderObject(obj, level, skipKeys = []) {
    let xml = '';

    for (const [key, value] of Object.entries(obj)) {
      // Skip primitive extension keys (handled separately)
      if (key.startsWith('_')) {
        continue;
      }
      if (skipKeys.includes(key)) {
        continue;
      }
      xml += this.renderElement(key, value, level);
    }

    return xml;
  }

  /**
   * Render elements in a specific order
   * @param {Object} obj - Object to render
   * @param {number} level - Indentation level
   * @param {Array<string>} elementOrder - Ordered list of element names
   * @returns {string} XML string
   */
  static renderElementsInOrder(obj, level, elementOrder) {
    let xml = '';

    // Process elements in order
    for (const key of elementOrder) {
      if (Object.hasOwn(obj, key) && key !== 'resourceType') {
        xml += this.renderElement(key, obj[key], level);
      }
    }

    // Process any remaining elements not in the order list
    for (const key of Object.keys(obj)) {
      if (!elementOrder.includes(key) && key !== 'resourceType' && !key.startsWith('_')) {
        xml += this.renderElement(key, obj[key], level);
      }
    }

    return xml;
  }

  /**
   * Generate XML declaration and root element wrapper
   * @param {string} resourceType - FHIR resource type
   * @param {string} content - Inner XML content
   * @returns {string} Complete XML document
   */
  static wrapInRootElement(resourceType, content) {
    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
    xml += `<${resourceType} xmlns="${this.getNamespace()}">\n`;
    xml += content;
    xml += `</${resourceType}>`;
    return xml;
  }

  // ==================== XML STRING PARSING ====================

  /**
   * Manual XML parser - parses XML string to element tree
   */
  static parseXmlString(xml) {
    const parser = new FhirXmlParser(xml);
    return parser.parse();
  }
}

/**
 * Simple XML parser for FHIR resources
 * Parses XML string into {name, attributes, children} structure
 */
class FhirXmlParser {
  constructor(xml) {
    this.xml = xml;
    this.pos = 0;
  }

  parse() {
    this._skipDeclaration();
    this._skipWhitespace();
    return this._parseElement();
  }

  _skipDeclaration() {
    this._skipWhitespace();
    if (this.xml.substring(this.pos, this.pos + 5) === '<?xml') {
      const end = this.xml.indexOf('?>', this.pos);
      if (end !== -1) {
        this.pos = end + 2;
      }
    }
  }

  _skipWhitespace() {
    while (this.pos < this.xml.length && /\s/.test(this.xml[this.pos])) {
      this.pos++;
    }
  }

  _parseElement() {
    this._skipWhitespace();

    if (this.xml[this.pos] !== '<') {
      throw new Error(`Expected '<' at position ${this.pos}`);
    }
    this.pos++; // Skip '<'

    // Parse element name
    const nameEnd = this.xml.substring(this.pos).search(/[\s/>]/);
    const name = this.xml.substring(this.pos, this.pos + nameEnd);
    this.pos += nameEnd;

    // Parse attributes
    const attributes = {};
    this._skipWhitespace();

    while (this.pos < this.xml.length && this.xml[this.pos] !== '>' && this.xml[this.pos] !== '/') {
      const attr = this._parseAttribute();
      if (attr) {
        attributes[attr.name] = attr.value;
      }
      this._skipWhitespace();
    }

    const children = [];

    // Self-closing tag
    if (this.xml[this.pos] === '/') {
      this.pos += 2; // Skip '/>'
      return { name, attributes, children };
    }

    this.pos++; // Skip '>'

    // Parse children
    while (this.pos < this.xml.length) {
      this._skipWhitespace();

      if (this.xml.substring(this.pos, this.pos + 2) === '</') {
        // Closing tag
        const closeEnd = this.xml.indexOf('>', this.pos);
        this.pos = closeEnd + 1;
        break;
      }

      if (this.xml[this.pos] === '<') {
        // Check for comment
        if (this.xml.substring(this.pos, this.pos + 4) === '<!--') {
          const commentEnd = this.xml.indexOf('-->', this.pos);
          this.pos = commentEnd + 3;
          continue;
        }

        children.push(this._parseElement());
      } else {
        // Text content - skip for FHIR as values are in attributes
        const textEnd = this.xml.indexOf('<', this.pos);
        this.pos = textEnd;
      }
    }

    return { name, attributes, children };
  }

  _parseAttribute() {
    this._skipWhitespace();

    if (this.xml[this.pos] === '>' || this.xml[this.pos] === '/') {
      return null;
    }

    // Parse attribute name
    const eqPos = this.xml.indexOf('=', this.pos);
    const name = this.xml.substring(this.pos, eqPos).trim();
    this.pos = eqPos + 1;

    // Skip whitespace and opening quote
    this._skipWhitespace();
    const quote = this.xml[this.pos];
    this.pos++;

    // Parse attribute value
    const valueEnd = this.xml.indexOf(quote, this.pos);
    const value = FhirXmlBase.unescapeXml(this.xml.substring(this.pos, valueEnd));
    this.pos = valueEnd + 1;

    return { name, value };
  }
}

module.exports = { FhirXmlBase, FhirXmlParser };