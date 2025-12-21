# NpmProjector Module

Watches a local npm package directory and serves FHIR resources with FHIRPath-based search indexes. Part of the FHIR Development Server.

## Features

- **Hot reload**: Automatically rebuilds indexes when files in the watched directory change
- **Atomic swap**: In-flight requests complete against consistent data during reloads
- **FHIRPath-based indexing**: Uses `fhirpath` library to evaluate SearchParameter expressions
- **Standard FHIR search**: Supports string, token, reference, date, quantity, number, and uri parameter types
- **Bundle support**: Automatically extracts resources from FHIR Bundles

## Configuration

Add to your `config.json`:

```json
{
  "modules": {
    "npmprojector": {
      "enabled": true,
      "basePath": "/fhir",
      "npmPath": "/path/to/fhir/package.tgz",
      "fhirVersion": "r4",
      "resourceTypes": ["Medication"],
      "resourceFolders": ["data/medications"],
      "searchParametersFolder": "data/search",
      "searchParametersPath": "/path/to/external/search-params",
      "debounceMs": 500
    }
  }
}
```

### Configuration Options

| Option | Required | Default | Description |
|--------|----------|---------|-------------|
| `enabled` | Yes | - | Whether the module is enabled |
| `basePath` | No | `/npmprojector` | URL path to mount the module |
| `npmPath` | Yes | - | Path to directory or .tgz file containing FHIR resources |
| `fhirVersion` | No | `r4` | FHIR version: `r4`, `r5`, `stu3`, `dstu2` |
| `resourceTypes` | No | all | Array of resource types to serve (omit/null for all) |
| `resourceFolders` | No | all | Array of subfolders within package to load resources from |
| `searchParametersFolder` | No | - | Subfolder within the package containing SearchParameters |
| `searchParametersPath` | No | - | External path to load additional SearchParameters from |
| `debounceMs` | No | 500 | Debounce time for file change detection |

### Folder Options Explained

**resourceFolders**: Only load resources from specific subfolders within the package. Paths are relative to the package root. If not specified, all folders are scanned.

```json
"resourceFolders": ["data/medications", "data/patients"]
```

**searchParametersFolder**: Load SearchParameters from a specific subfolder within the package (instead of finding them mixed in with resources).

```json
"searchParametersFolder": "data/search"
```

**searchParametersPath**: Load SearchParameters from an external location (outside the package). This is useful for loading standard FHIR search parameters.

```json
"searchParametersPath": "/Users/you/.fhir/packages/hl7.fhir.r4.core#4.0.1/package"
```

Both `searchParametersFolder` and `searchParametersPath` can be used together - they will be merged.

## Server Integration

Add to `server.js`:

```javascript
const NpmProjectorModule = require('./npmprojector/npmprojector.js');

// In initializeModules():
if (config.modules.npmprojector && config.modules.npmprojector.enabled) {
  try {
    modules.npmprojector = new NpmProjectorModule();
    await modules.npmprojector.initialize(config.modules.npmprojector);
    
    // Use configured basePath or default
    const basePath = NpmProjectorModule.getBasePath(config.modules.npmprojector);
    app.use(basePath, modules.npmprojector.router);
  } catch (error) {
    serverLog.error('Failed to initialize NpmProjector module:', error);
    throw error;
  }
}
```

## Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /npmprojector/` | Module info and available resource types |
| `GET /npmprojector/metadata` | FHIR CapabilityStatement |
| `GET /npmprojector/_stats` | Index statistics |
| `POST /npmprojector/_reload` | Trigger manual reload |
| `GET /npmprojector/[ResourceType]` | Search resources |
| `GET /npmprojector/[ResourceType]/[id]` | Read a single resource |

## Search Examples

```bash
# Get all patients
curl http://localhost:3000/npmprojector/Patient

# Search by family name (case-insensitive, starts-with)
curl "http://localhost:3000/npmprojector/Patient?family=smith"

# Search by gender (token)
curl "http://localhost:3000/npmprojector/Patient?gender=male"

# Search by identifier with system
curl "http://localhost:3000/npmprojector/Patient?identifier=http://example.org/mrn|12345"

# Search observations by code (LOINC)
curl "http://localhost:3000/npmprojector/Observation?code=http://loinc.org|8867-4"

# OR search (comma-separated)
curl "http://localhost:3000/npmprojector/Patient?gender=male,female"

# Multiple parameters (AND)
curl "http://localhost:3000/npmprojector/Patient?family=smith&gender=male"
```

## Directory Structure

The watched directory should contain JSON files with FHIR resources:

```
your-fhir-package/
├── resources.json          # Bundle of Patient, Observation, etc.
├── search-parameters.json  # Bundle of SearchParameter definitions
└── more-data/
    └── additional.json     # More resources (recursively loaded)
```

SearchParameter resources can be:
1. Mixed in with other resources in the watched directory
2. Loaded from a separate `searchParametersPath` location
3. Both (they will be merged)

## Supported Search Parameter Types

| Type | Behavior |
|------|----------|
| `string` | Case-insensitive starts-with matching |
| `token` | Supports `system|code`, `|code`, `code`, `system|` |
| `reference` | Exact match on reference string |
| `date` | Prefix matching on ISO date strings |
| `quantity` | Numeric equality |
| `number` | Numeric equality |
| `uri` | Exact match |

## Limitations

- **Read-only**: No create/update/delete operations
- **No chained search**: `subject.name=John` not supported
- **No _include/_revinclude**: Related resources not included
- **No date ranges**: `ge`, `le`, `gt`, `lt` prefixes not supported
- **No composite parameters**: Multi-field search params not supported
- **No modifiers**: `:exact`, `:contains`, `:missing` not supported

## Dependencies

Requires `fhirpath`, `chokidar`, and `tar` packages:

```bash
npm install fhirpath chokidar tar
```
