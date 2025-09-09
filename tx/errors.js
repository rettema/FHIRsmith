
// Custom error types
class TerminologyError extends Error {
  constructor(message) {
    super(message);
    this.name = 'TerminologyError';
  }
}

class TooCostlyError extends Error {
  constructor(message) {
    super(message);
    this.name = 'TooCostlyError';
    this.diagnostics = '';
  }
}


module.exports = {
  TerminologyError,
  TooCostlyError
};