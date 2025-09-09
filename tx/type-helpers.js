
const {validateParameter} = require("../library/utilities");

class TypeHelper {

  static readString(value, name) {
    validateParameter(value, "value", Object);
    validateParameter(name, "name", String);
    let res = value["_"+name];
    if (res == null) {
      res = {};
    }
    res.value = value[name];
    return res;
  }

  static makeString(value) {
    validateParameter(value, "value", String);
    return { "value" : value };
  }
}
module.exports = {
  TypeHelper
};