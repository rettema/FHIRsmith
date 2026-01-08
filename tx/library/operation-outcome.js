const {validateParameter} = require("../../library/utilities");

class Issue extends Error {
  level;
  cause;
  path;
  msgId;
  issue;
  statusCode;
  isSetForhandleAsOO;
  diagnostics;

  constructor (level, cause, path, msgId, message, issue = null, statusCode = 500) {
    super(message);
    this.level = level;
    this.cause = cause;
    this.path = path;
    this.message = message;
    this.msgId = msgId;
    this.issue = issue;
    this.statusCode = statusCode;
  }

  asIssue() {
    let res = {
      severity: this.level,
      code: this.cause,
      details: {
        text: this.message
      },
      location: [ this.path ],
      expression: [ this.path ]
    }
    if (this.issue) {
      res.details.coding = [{ system: "http://hl7.org/fhir/tools/CodeSystem/tx-issue-type", code : this.issue }];
    }
    if (this.msgId) {
      res.extension = [{ url: "http://hl7.org/fhir/StructureDefinition/operationoutcome-message-id", valueString: this.msgId }];
    }
    if (this.diagnostics) {
      res.diagnostics = this.diagnostics;
    }
    return res;
  }

  handleAsOO(statusCode) {
    this.isSetForhandleAsOO = true;
    this.statusCode = statusCode;
    return this;
  }

  isHandleAsOO() {
    return this.isSetForhandleAsOO;
  }

  setFinished() {
    this.finished = true;
    return this;
  }
  setUnknownSystem(s) {
    this.unknownSystem = s;
    return this;
  }

  withDiagnostics(diagnostics) {
    this.diagnostics = diagnostics;
    return this;
  }
}

class OperationOutcome {
  jsonObj;

  constructor (jsonObj = null) {
    this.jsonObj = jsonObj ? jsonObj : { "resourceType": "OperationOutcome" };
  }

  addIssue(newIssue, ifNotDuplicate = false) {
    validateParameter(newIssue, "newIssue", Object);
    if (ifNotDuplicate) {
      for (let iss of this.jsonObj.issue || []) {
        if (iss.details.text === newIssue.message) {
          return false;
        }
      }
    }
    if (!this.jsonObj.issue) {
      this.jsonObj.issue = [];
    }
    this.jsonObj.issue.push(newIssue.asIssue());
    return true;
  }

  hasIssues() {
    return this.jsonObj && this.jsonObj.issue;
  }

  hasErrors() {
    for (let iss of this.jsonObj.issue || []) {
      if (iss.severity === 'error') {
        return true;
      }
    }
    return false;
  }

  listMissedErrors(list) {
    for (let iss of this.jsonObj.issue || []) {
      if (iss.severity === 'error' && iss.details && iss.details.text && !list.find(msg => msg === iss.details.text )) {
        return list.push(iss.details.text);
      }
    }

  }
}

module.exports = { OperationOutcome, Issue };