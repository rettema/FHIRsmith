const {validateParameter} = require("../../library/utilities");

class Parameters {
  jsonObj;

  constructor (jsonObj = null) {
    this.jsonObj = jsonObj ? jsonObj : { "resourceType": "Parameters" };
  }

  addParamStr(name, value) {
    if (!this.jsonObj.parameter) {
      this.jsonObj.parameter = [];
    }
    this.jsonObj.parameter.push({ name: name, valueString : value });
  }

  addParam(name, valuename, value) {
    if (!this.jsonObj.parameter) {
      this.jsonObj.parameter = [];
    }
    let v = { name: name };
    v[valuename] = value;
    this.jsonObj.parameter.push(v);
  }

  addParamUri(name, value) {
    if (!this.jsonObj.parameter) {
      this.jsonObj.parameter = [];
    }
    this.jsonObj.parameter.push({ name: name, valueUri : value });
  }

  addParamCanonical(name, value) {
    if (!this.jsonObj.parameter) {
      this.jsonObj.parameter = [];
    }
    this.jsonObj.parameter.push({ name: name, valueCanonical : value });
  }

  addParamCode(name, value) {
    if (!this.jsonObj.parameter) {
      this.jsonObj.parameter = [];
    }
    this.jsonObj.parameter.push({ name: name, valueCode : value });
  }

  addParamBool(name, value) {
    if (!this.jsonObj.parameter) {
      this.jsonObj.parameter = [];
    }
    this.jsonObj.parameter.push({ name: name, valueBoolean : value });
  }

  addParamResource(name, resource) {
    if (!this.jsonObj.parameter) {
      this.jsonObj.parameter = [];
    }
    this.jsonObj.parameter.push({ name: name, resource : resource });
  }
}

module.exports = { Parameters };