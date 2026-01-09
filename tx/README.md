# TX Module - FHIR Terminology Server

The TX module provides FHIR terminology services for CodeSystem, ValueSet, and ConceptMap resources. It supports multiple endpoints at different FHIR versions, all backed by a shared terminology library.

## Todo

* check the HTML interface 
* add more tests for the code system providers - filters, extended lookup, designations and languages 
* more refactoring in validate.js and expand.js 
* full batch support 
* check R4 and R3 support 
* check vsac support 
* get tx tests running in pipelines 


## Overview

Unlike other modules in this server that mount at a single path (e.g., `/shl`, `/packages`), the TX module registers multiple endpoints directly at the root level. Each endpoint is configured with its own path, FHIR version, and optional context string.

When a request arrives at an endpoint, the module:
1. Creates a Provider instance from the shared Library using the configured FHIR version and context
2. Passes the Provider to the appropriate worker to handle the operation
3. Returns the FHIR-compliant response

## Configuration

Add the `tx` section to your `config.json`:

```json
{
  "modules": {
    "tx": {
      "enabled": true,
      "librarySource": "/path/to/library.yml",
      "endpoints": [
        {
          "path": "/tx/r5",
          "fhirVersion": 5,
          "context": null
        },
        {
          "path": "/tx/r4",
          "fhirVersion": 4,
          "context": null
        },
        {
          "path": "/tx/r3",
          "fhirVersion": 3,
          "context": null
        },
        {
          "path": "/tx/r4/demo",
          "fhirVersion": 4,
          "context": "demo"
        }
      ]
    }
  }
}
```

### Configuration Options

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `enabled` | boolean | Yes | Whether the module is enabled |
| `librarySource` | string | Yes | Path to the YAML file that defines the terminology library sources |
| `endpoints` | array | Yes | List of endpoint configurations (at least one required) |

### Endpoint Configuration

Each endpoint in the `endpoints` array has:

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `path` | string | Yes | The URL path where this endpoint will be mounted (e.g., `/tx/r4`) |
| `fhirVersion` | number | Yes | FHIR version: `3` (STU3), `4` (R4), `5` (R5), or `6` (R6) |
| `context` | string | No | Optional context string passed to the Library when creating Providers |

**Note:** Endpoint paths must be unique. The module will throw an error if duplicate paths are configured or if a path conflicts with another module.

## Supported Operations

Each endpoint provides the following FHIR terminology operations:

### CodeSystem Operations

| Operation | Endpoints | Methods |
|-----------|-----------|---------|
| Read | `GET /{path}/CodeSystem/{id}` | GET |
| Search | `GET /{path}/CodeSystem?{params}` | GET, POST |
| $lookup | `GET/POST /{path}/CodeSystem/$lookup` | GET, POST |
| $lookup (instance) | `GET/POST /{path}/CodeSystem/{id}/$lookup` | GET, POST |
| $validate-code | `GET/POST /{path}/CodeSystem/$validate-code` | GET, POST |
| $validate-code (instance) | `GET/POST /{path}/CodeSystem/{id}/$validate-code` | GET, POST |
| $subsumes | `GET/POST /{path}/CodeSystem/$subsumes` | GET, POST |
| $subsumes (instance) | `GET/POST /{path}/CodeSystem/{id}/$subsumes` | GET, POST |

### ValueSet Operations

| Operation | Endpoints | Methods |
|-----------|-----------|---------|
| Read | `GET /{path}/ValueSet/{id}` | GET |
| Search | `GET /{path}/ValueSet?{params}` | GET, POST |
| $expand | `GET/POST /{path}/ValueSet/$expand` | GET, POST |
| $expand (instance) | `GET/POST /{path}/ValueSet/{id}/$expand` | GET, POST |
| $validate-code | `GET/POST /{path}/ValueSet/$validate-code` | GET, POST |
| $validate-code (instance) | `GET/POST /{path}/ValueSet/{id}/$validate-code` | GET, POST |

### ConceptMap Operations

| Operation | Endpoints | Methods |
|-----------|-----------|---------|
| Read | `GET /{path}/ConceptMap/{id}` | GET |
| Search | `GET /{path}/ConceptMap?{params}` | GET, POST |
| $translate | `GET/POST /{path}/ConceptMap/$translate` | GET, POST |
| $translate (instance) | `GET/POST /{path}/ConceptMap/{id}/$translate` | GET, POST |
| $closure | `GET/POST /{path}/ConceptMap/$closure` | GET, POST |

### Metadata

Each endpoint also provides:
- `GET /{path}/metadata` - Returns a CapabilityStatement describing the endpoint's capabilities
- `GET /{path}/` - Returns basic endpoint information

## Library Configuration

The `librarySource` YAML file defines what terminology content is loaded. See the Library class documentation for details on the YAML format and supported source types (internal, ucum, loinc, snomed, npm packages, etc.).

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                         Library                              │
│  (Loaded once at startup from YAML)                         │
│  - Code System Factories                                    │
│  - Code System Providers                                    │
│  - Value Set Providers                                      │
└─────────────────────────────────────────────────────────────┘
                              │
                              │ cloneWithFhirVersion(version, context)
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                         Provider                             │
│  (Created per-request with FHIR version context)            │
└─────────────────────────────────────────────────────────────┘
                              │
          ┌───────────────────┼───────────────────┐
          ▼                   ▼                   ▼
    ┌──────────┐        ┌──────────┐        ┌──────────┐
    │  /tx/r5  │        │  /tx/r4  │        │  /tx/r3  │
    │ FHIR R5  │        │ FHIR R4  │        │ FHIR R3  │
    └──────────┘        └──────────┘        └──────────┘
```

## Workers

The module uses worker classes to handle specific operations:

| Worker | Operations |
|--------|------------|
| `read.js` | Resource read operations |
| `search.js` | Resource search operations |
| `lookup.js` | CodeSystem $lookup |
| `subsumes.js` | CodeSystem $subsumes |
| `validate.js` | CodeSystem and ValueSet $validate-code |
| `expand.js` | ValueSet $expand |
| `translate.js` | ConceptMap $translate |
| `closure.js` | ConceptMap $closure |

## Error Handling

All errors are returned as FHIR OperationOutcome resources:

```json
{
  "resourceType": "OperationOutcome",
  "issue": [{
    "severity": "error",
    "code": "not-found",
    "diagnostics": "CodeSystem/example not found"
  }]
}
```

## Health Check

The module reports its status via the `/health` endpoint:

```json
{
  "modules": {
    "tx": {
      "enabled": true,
      "status": "Running",
      "endpoints": [
        { "path": "/tx/r5", "fhirVersion": 5, "context": null },
        { "path": "/tx/r4", "fhirVersion": 4, "context": null }
      ]
    }
  }
}
```

## Notes

- Write operations (PUT, POST, DELETE, PATCH) on resources are not supported and return 405 Method Not Allowed
- The Library is loaded once at startup; changes to the YAML source require a server restart
- Each request creates a fresh Provider instance, ensuring thread-safety and version isolation
