const {VersionUtilities} = require("../../library/version-utilities");

/**
 * Converts input ValueSet to R5 format (modifies input object for performance)
 * @param {Object} jsonObj - The input ValueSet object
 * @param {string} version - Source FHIR version
 * @returns {Object} The same object, potentially modified to R5 format
 * @private
 */

function valueSetToR5(jsonObj, sourceVersion) {
  if (VersionUtilities.isR5Ver(sourceVersion)) {
    return jsonObj; // No conversion needed
  }
  return jsonObj;
}

/**
 * Converts R5 ValueSet to target version format (clones object first)
 * @param {Object} r5Obj - The R5 format ValueSet object
 * @param {string} targetVersion - Target FHIR version
 * @returns {Object} New object in target version format
 * @private
 */
function valueSetFromR5(r5Obj, targetVersion) {
  if (VersionUtilities.isR5Ver(targetVersion)) {
    return r5Obj; // No conversion needed
  }

  // Clone the object to avoid modifying the original
  const cloned = JSON.parse(JSON.stringify(r5Obj));

  if (VersionUtilities.isR4Ver(targetVersion)) {
    return valueSetR5ToR4(cloned);
  } else if (VersionUtilities.isR3Ver(targetVersion)) {
    return valueSetR5ToR3(cloned);
  }

  throw new Error(`Unsupported target FHIR version: ${targetVersion}`);
}

/**
 * Converts R5 ValueSet to R4 format
 * @param {Object} r5Obj - Cloned R5 ValueSet object
 * @returns {Object} R4 format ValueSet
 * @private
 */
function valueSetR5ToR4(r5Obj) {

  return r5Obj;
}

/**
 * Converts R5 ValueSet to R3 format
 * @param {Object} r5Obj - Cloned R5 ValueSet object
 * @returns {Object} R3 format ValueSet
 * @private
 */
function valueSetR5ToR3(r5Obj) {
  // First apply R4 conversions
  const r4Obj = valueSetR5ToR4(r5Obj);

  return r4Obj;
}

module.exports = { valueSetToR5, valueSetFromR5 };