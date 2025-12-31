const {getValuePrimitive} = require("../../library/utilities");

const Extensions = {

  list(object, url) {
    if (object.extension) {
      let res = [];
      for (let extension of object.extension) {
        if (extension.url === url) {
          res.push(extension);
        }
      }
      return res;
    } else {
      return [];
    }
  },

  checkNoImplicitRules(valueSet, place, name) {

  },
  checkNoModifiers(valueSet, prepare1, valueSet1) {
    return true;
  },

  readString(resource, url) {
    for (let ext of resource.extension || []) {
      if (ext.url === url) {
        return getValuePrimitive(ext);
      }
    }
    return null;
  },

  readValue(resource, url) {
    for (let ext of resource.extension || []) {
      if (ext.url === url) {
        return ext;
      }
    }
    return null;
  },

  has(object, url) {
    return (object.extension || []).find(ex => ex.url === url);
  }
}

module.exports = { Extensions };
