const {CodeSystemProvider} = require("../cs/cs-api");

class Renderer {

  static renderCoded(...args) {
  if (args.length === 1) {
    const arg = args[0];
    if (arg.systemUri !== undefined && arg.version !== undefined && arg.code !== undefined && arg.display !== undefined) {
      // It's a Coding
      return Renderer.renderCodedCoding(arg);
    } else if (arg.coding !== undefined) {
      // It's a CodeableConcept
      return Renderer.renderCodedCodeableConcept(arg);
    } else if (arg.systemUri !== undefined && arg.version !== undefined) {
      // It's a CodeSystemProvider
      return Renderer.renderCodedProvider(arg);
    } else if (arg instanceof CodeSystemProvider) {
      let cs = arg;
      return cs.system()+"|"+cs.version();
    }
  } else if (args.length === 2) {
    return Renderer.renderCodedSystemVersion(args[0], args[1]);
  } else if (args.length === 3) {
    return Renderer.renderCodedSystemVersionCode(args[0], args[1], args[2]);
  } else if (args.length === 4) {
    return Renderer.renderCodedSystemVersionCodeDisplay(args[0], args[1], args[2], args[3]);
  }
  throw new Error('Invalid arguments to renderCoded');
}

static renderCodedProvider(system) {
  let result = system.systemUri + '|' + system.version;
  if (system.sourcePackage !== '') {
    result = result + ' (from ' + system.sourcePackage + ')';
  }
  return result;
}

static renderCodedSystemVersion(system, version) {
  if (version === '') {
    return system;
  } else {
    return system + '|' + version;
  }
}

static renderCodedSystemVersionCode(system, version, code) {
  return Renderer.renderCodedSystemVersion(system, version) + '#' + code;
}

static renderCodedSystemVersionCodeDisplay(system, version, code, display) {
  return Renderer.renderCodedSystemVersionCode(system, version, code) + ' ("' + display + '")';
}

static renderCodedCoding(code) {
  return Renderer.renderCodedSystemVersionCodeDisplay(code.systemUri, code.version, code.code, code.display);
}

static renderCodedCodeableConcept(code) {
  let result = '';
  for (const c of code.coding) {
    if (result !== '') {
      result = result + ', ';
    }
    result = result + Renderer.renderCodedCoding(c);
  }
  return '[' + result + ']';
}

static renderInclude(inc) {
  let result;
  if (inc.systemUri !== '') {
    result = '(' + inc.systemUri + ')';
    if (inc.hasConcepts) {
      result = result + '(';
      let first = true;
      for (const cc of inc.concepts) {
        if (first) {
          first = false;
        } else {
          result = result + ',';
        }
        result = result + cc.code;
      }
      result = result + ')';
    }
    if (inc.hasFilters) {
      result = result + '(';
      let first = true;
      for (const ci of inc.filters) {
        if (first) {
          first = false;
        } else {
          result = result + ',';
        }
        result = result + ci.prop + ci.op + ci.value;
      }
      result = result + ')';
    }
  } else {
    result = '(';
    let first = true;
    for (const s of inc.valueSets) {
      if (first) {
        first = false;
      } else {
        result = result + ',';
      }
      result = result + '^' + s;
    }
    result = result + ')';
  }
  return result;
}
  
}

module.exports = { Renderer };
