//
// TX HTML Rendering Module
//
// Renders FHIR resources as HTML for browser clients
//

const path = require('path');
const htmlServer = require('../common/html-server');
const Logger = require('../common/logger');

const txHtmlLog = Logger.getInstance().child({ module: 'tx-html' });

const TEMPLATE_PATH = path.join(__dirname, 'tx-template.html');

// Search parameters for the search form
const SEARCH_PARAMS = [
  { name: 'url', type: 'text', label: 'URL' },
  { name: 'version', type: 'text', label: 'Version' },
  { name: 'name', type: 'text', label: 'Name' },
  { name: 'title', type: 'text', label: 'Title' },
  { name: 'status', type: 'select', label: 'Status', options: ['', 'draft', 'active', 'retired', 'unknown'] },
  { name: 'publisher', type: 'text', label: 'Publisher' },
  { name: 'description', type: 'text', label: 'Description' },
  { name: 'identifier', type: 'text', label: 'Identifier' },
  { name: 'jurisdiction', type: 'text', label: 'Jurisdiction' },
  { name: 'date', type: 'text', label: 'Date' }
];

const CODESYSTEM_PARAMS = [
  ...SEARCH_PARAMS,
  { name: 'content-mode', type: 'select', label: 'Content Mode', options: ['', 'not-present', 'example', 'fragment', 'complete', 'supplement'] },
  { name: 'supplements', type: 'text', label: 'Supplements' },
  { name: 'system', type: 'text', label: 'System' }
];

const SORT_OPTIONS = ['', 'id', 'url', 'version', 'date', 'name', 'vurl'];

const ELEMENT_OPTIONS = ['id', 'url', 'version', 'name', 'title', 'status', 'date', 'publisher', 'description'];

/**
 * Load the TX HTML template
 */
function loadTemplate() {
  try {
    const templateLoaded = htmlServer.loadTemplate('tx', TEMPLATE_PATH);
    if (!templateLoaded) {
      txHtmlLog.error('Failed to load TX HTML template');
    }
  } catch (error) {
    txHtmlLog.error(`Failed to load TX HTML template: ${error.message}`);
  }
}

/**
 * Escape HTML special characters
 */
function escapeHtml(text) {
  if (text === null || text === undefined) {
    return '';
  }
  if (typeof text !== 'string') {
    return String(text);
  }
  
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#x27;'
  };
  
  return text.replace(/[&<>"']/g, m => map[m]);
}

/**
 * Render a page with the TX template
 */
function renderPage(title, content, endpoint, startTime) {
  const options = {
    'endpoint-path': endpoint.path,
    'fhir-version': endpoint.fhirVersion,
    'ms': Date.now() - startTime
  };
  
  return htmlServer.renderPage('tx', title, content, options);
}

/**
 * Check if request accepts HTML
 */
function acceptsHtml(req) {
  const accept = req.headers.accept || '';
  return accept.includes('text/html');
}

/**
 * Build page title from JSON response
 */
function buildTitle(json) {
  const resourceType = json.resourceType || 'Response';
  
  if (resourceType === 'Bundle' && json.type === 'searchset') {
    // Extract the resource type being searched from self link or entries
    const selfLink = json.link?.find(l => l.relation === 'self')?.url || '';
    const typeMatch = selfLink.match(/\/(CodeSystem|ValueSet|ConceptMap)\?/);
    if (typeMatch) {
      return `Search: ${typeMatch[1]}`;
    }
    const firstEntry = json.entry?.[0]?.resource;
    const searchedType = firstEntry?.resourceType || 'Resources';
    return `Search: ${searchedType}`;
  }
  
  if (resourceType === 'OperationOutcome') {
    const severity = json.issue?.[0]?.severity || 'info';
    return `${severity.charAt(0).toUpperCase() + severity.slice(1)}`;
  }
  
  if (json.id) {
    return `${resourceType}/${json.id}`;
  }
  
  if (json.name) {
    return `${resourceType}: ${json.name}`;
  }
  
  return resourceType;
}


// eslint-disable-next-line no-unused-vars
function buildSearchForm(req, mode, params) {
  let html = '';

  // Search form
  html += '<h3>Search</h3>';

  html += `<form method="get" action="${escapeHtml(req.baseUrl)}/CodeSystem">`;
  html += '<table class="grid" cellpadding="0" cellspacing="0">';
  html += '<tr>';
  html += '<td colspan="2">URL: <input type="text" name="url" size="40"/></td>';
  html += '<td>Version: <input type="text" name="version"/></td>';
  html += '</tr>';
  html += '<tr>';
  html += '<td title="Searches in name, title, description, publisher">Text: <input type="text" name="text"/></td>';
  html += '<td>Status: <select name="status" class="form-select"><option value="">(any status)</option>';
  html += '<option value="draft">draft</option><option value="active">active</option>';
  html += '<option value="retired">retired</option><option value="unknown">unknown</option></select></td>';
  html += '<td>Language: <input type="text" name="lang" size="10"/> (ietf code)</td>';
  html += '</tr>';
  html += '<tr>';
  html += '<td colspan="2" title="CodeSystem - for supplements, value sets, and concept maps">System: <input type="text" name="system" size="40"/></td>';
  html += '<td>CS Content: <select name="content-mode" class="form-select"><option value="">(any content)</option>';
  html += '<option value="not-present">not-present</option><option value="example">example</option>';
  html += '<option value="fragment">fragment</option><option value="complete">complete</option>';
  html += '<option value="supplement">supplement</option></select></td>';
  html += '</tr>';
  html += '</table>';
  html += '<button type="submit" class="btn btn-primary">Search:</button>';
  html += ' <input type="radio" name="mode" value="cs" selected/> CodeSystems';
  html += ' <input type="radio" name="mode" value="vs"/> ValueSets';
  html += ' <input type="radio" name="mode" value="""cm"/> ConceptMaps';
  html += '</form>';

  return html;
}

function buildHomePage(req) {
  const provider = req.txProvider;

  let html = '';

  // ===== Summary Section =====
  html += '<h3>Server Summary</h3>';

  // Calculate uptime
  const uptimeMs = Date.now() - provider.startTime;
  const uptimeSeconds = Math.floor(uptimeMs / 1000);
  const uptimeDays = Math.floor(uptimeSeconds / 86400);
  const uptimeHours = Math.floor((uptimeSeconds % 86400) / 3600);
  const uptimeMinutes = Math.floor((uptimeSeconds % 3600) / 60);
  const uptimeSecs = uptimeSeconds % 60;
  let uptimeStr = '';
  if (uptimeDays > 0) uptimeStr += `${uptimeDays}d `;
  if (uptimeHours > 0 || uptimeDays > 0) uptimeStr += `${uptimeHours}h `;
  if (uptimeMinutes > 0 || uptimeHours > 0 || uptimeDays > 0) uptimeStr += `${uptimeMinutes}m `;
  uptimeStr += `${uptimeSecs}s`;

  // Memory usage
  const memUsage = process.memoryUsage();
  const heapUsedMB = (memUsage.heapUsed / 1024 / 1024).toFixed(2);
  const heapTotalMB = (memUsage.heapTotal / 1024 / 1024).toFixed(2);
  const rssMB = (memUsage.rss / 1024 / 1024).toFixed(2);

  html += '<table class="grid">';
  html += '<tr>';
  html += `<td><strong>FHIR Version:</strong> ${escapeHtml(provider.getFhirVersion())}</td>`;
  html += `<td><strong>Uptime:</strong> ${escapeHtml(uptimeStr)}</td>`;
  html += `<td><strong>Request Count:</strong> ${provider.requestCount}</td>`;
  html += '</tr>';
  html += '<tr>';
  html += `<td><strong>Heap Used:</strong> ${heapUsedMB} MB</td>`;
  html += `<td><strong>Heap Total:</strong> ${heapTotalMB} MB</td>`;
  html += `<td><strong>Process Memory:</strong> ${rssMB} MB</td>`;
  html += '</tr>';

  // Count unique code systems
  const uniqueFactorySystems = new Set();
  for (const factory of provider.codeSystemFactories.values()) {
    uniqueFactorySystems.add(factory.system());
  }
  const uniqueCodeSystems = new Set();
  for (const cs of provider.codeSystems.values()) {
    uniqueCodeSystems.add(cs.url);
  }
  html += '<tr>';
  html += `<td><strong>CodeSystem #:</strong> ${new Set([...uniqueFactorySystems, ...uniqueCodeSystems]).size}</td>`;

  // Count value sets
  let totalValueSets = 0;
  for (const vsp of provider.valueSetProviders) {
    totalValueSets += vsp.vsCount();
  }
  html += `<td><strong>ValueSet #:</strong> ${totalValueSets || 'Unknown'}</td>`;

  let totalConceptMaps = 0;
  for (const cmp of provider.conceptMapProviders) {
    totalConceptMaps += cmp.cmCount();
  }
  html += `<td><strong>ConceptMap #:</strong> ${totalConceptMaps || 'Unknown'}</td>`;
  html += '</tr>';
  html += '</table>';

  html += '<hr/>';
  html += buildSearchForm(req);
  //
  //
  // // Translation form
  // html += '<h6 class="mt-4">Translate</h6>';
  // html += `<form method="get" action="${escapeHtml(req.baseUrl)}/ConceptMap/$translate">`;
  // html += '<div class="row">';
  // html += '<div><input type="text" name="system" placeholder="Source System" required/></div>';
  // html += '<div><input type="text" name="code" placeholder="Code" required/></div>';
  // html += '<div><input type="text" name="targetSystem" placeholder="Target System"/></div>';
  // html += '</div>';
  // html += '<div class="row">';
  // html += '<div class="col-md-6 mb-2">';
  // html += '</div>';
  // html += '</div>';
  // html += '<button type="submit" class="btn btn-primary">Translate</button>';
  // html += '</form>';
  //
  // Search form for concept maps
  // html += '<h6 class="mt-4">Search Concept Maps</h6>';
  // html += `<form method="get" action="${escapeHtml(req.baseUrl)}/ConceptMap">`;
  // html += '<div class="row">';
  // html += '<div><input type="text" name="_id" placeholder="ID"/></div>';
  // html += '<div><input type="text" name="url" placeholder="URL"/></div>';
  // html += '<div><input type="text" name="name" placeholder="Name"/></div>';
  // html += '<div><input type="text" name="title" placeholder="Title"/></div>';
  // html += '</div>';
  // html += '<button type="submit" class="btn btn-primary">Search</button>';
  // html += '</form>';
  // html += '</div></div>';

  // ===== Packages and Factories Section =====
  html += '<hr/><h3>Content Sources &amp; Code System Factories</h3>';

  // List content sources
  html += '<h6>Content Sources</h6>';
  if (provider.contentSources && provider.contentSources.length > 0) {
    const sorted = [...provider.contentSources].sort();
    html += '<ul>';
    for (const source of sorted) {
      html += `<li>${escapeHtml(source)}</li>`;
    }
    html += '</ul>';
  } else {
    html += '<p><em>No content sources available</em></p>';
  }

  // Code System Factories table
// Code System Factories table
  html += '<h6 class="mt-4">External CodeSystems</h6>';
  html += '<table class="grid">';
  html += '<thead><tr><th>System</th><th>Version</th><th>Use Count</th></tr></thead>';
  html += '<tbody>';

// Deduplicate factories and sort by system URL
  const seenFactories = new Set();
  const uniqueFactories = [];
  for (const factory of provider.codeSystemFactories.values()) {
    const key = factory.system() + '|' + (factory.version() || '');
    if (!seenFactories.has(key)) {
      seenFactories.add(key);
      uniqueFactories.push(factory);
    }
  }
  uniqueFactories.sort((a, b) => a.system().localeCompare(b.system()));

  for (const factory of uniqueFactories) {
    html += '<tr>';
    html += `<td>${escapeHtml(factory.system())}</td>`;
    html += `<td>${escapeHtml(factory.version() || '-')}</td>`;
    html += `<td>${factory.useCount ? factory.useCount() : '-'}</td>`;
    html += '</tr>';
  }

  html += '</tbody></table>';
  html += '</div></div>';

  return html;
}

/**
 * Main render function - determines what to render based on resource type
 */
function render(json, req) {
  if (req.path == "/") {
    return buildHomePage(req);
  } else {
    const resourceType = json.resourceType;

    switch (resourceType) {
      case 'Parameters':
        return renderParameters(json);
      case 'CodeSystem':
        return renderCodeSystem(json);
      case 'ValueSet':
        return renderValueSet(json);
      case 'ConceptMap':
        return renderConceptMap(json);
      case 'CapabilityStatement':
        return renderCapabilityStatement(json);
      case 'Bundle':
        return renderBundle(json, req);
      case 'OperationOutcome':
        return renderOperationOutcome(json, req);
      default:
        return renderGeneric(json);
    }
  }
}

/**
 * Render Parameters resource
 */
function renderParameters(json) {
  // For now, just pretty-print JSON
  return `<pre>${escapeHtml(JSON.stringify(json, null, 2))}</pre>`;
}

/**
 * Render CodeSystem resource
 */
function renderCodeSystem(json) {
  // For now, just pretty-print JSON
  return `<pre>${escapeHtml(JSON.stringify(json, null, 2))}</pre>`;
}

/**
 * Render ValueSet resource
 */
function renderValueSet(json) {
  // For now, just pretty-print JSON
  return `<pre>${escapeHtml(JSON.stringify(json, null, 2))}</pre>`;
}

/**
 * Render ConceptMap resource
 */
function renderConceptMap(json) {
  // For now, just pretty-print JSON
  return `<pre>${escapeHtml(JSON.stringify(json, null, 2))}</pre>`;
}

/**
 * Render CapabilityStatement resource
 */
function renderCapabilityStatement(json) {
  // For now, just pretty-print JSON
  return `<pre>${escapeHtml(JSON.stringify(json, null, 2))}</pre>`;
}

/**
 * Render OperationOutcome resource
 */
function renderOperationOutcome(json) {
  let html = '<div class="operation-outcome">';
  html += `<h4>OperationOutcome</h4>`;

  if (json.issue && Array.isArray(json.issue)) {
    for (const issue of json.issue) {
      html += '<div class="alert ';

      // Determine alert style based on this issue's severity
      const severity = issue.severity || 'information';
      switch (severity) {
        case 'error':
        case 'fatal':
          html += 'alert-danger';
          break;
        case 'warning':
          html += 'alert-warning';
          break;
        case 'information':
          html += 'alert-info';
          break;
        default:
          html += 'alert-secondary';
      }

      html += '">';
      html += `<strong>${escapeHtml(issue.severity || 'unknown')}:</strong> `;
      html += `[${escapeHtml(issue.code || 'unknown')}] `;
      html += escapeHtml(issue.diagnostics || issue.details?.text || 'No details');
      html += '</div>';
    }
  }

  html += '</div>';
  return html;
}

/**
 * Render Bundle resource
 */
function renderBundle(json, req) {
  if (json.type === 'searchset') {
    return renderSearchBundle(json, req);
  }
  
  // Generic bundle rendering
  return renderGenericBundle(json, req);
}

/**
 * Render a search result Bundle
 */
function renderSearchBundle(json, req) {

  // Check if there are any actual search parameters (not just pagination/control params)
  const selfLink = json.link?.find(l => l.relation === 'self')?.url || '';
  const hasSearchParams = checkForSearchParams(selfLink);
  
  // If no search params provided, show the search form
  if (!hasSearchParams) {
    return renderSearchForm(json, req);
  }
  
  // Check if _elements was specified (look in self link)
  const elementsMatch = selfLink.match(/[?&]_elements=([^&]*)/);
  const elements = elementsMatch ? decodeURIComponent(elementsMatch[1]).split(',').map(e => e.trim()) : null;
  
  if (elements && elements.length > 0) {
    return renderSearchTable(json, elements, req);
  }
  
  // Default: render as summary with individual resources
  return renderSearchSummary(json, req);
}

/**
 * Check if URL has any actual search parameters (not just _offset, _count, _elements, _sort)
 */
function checkForSearchParams(url) {
  try {
    const urlObj = new URL(url);
    const controlParams = ['_offset', '_count', '_sort'];
    
    for (const [key, value] of urlObj.searchParams) {
      if (!controlParams.includes(key) && value) {
        return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Render search form (when no search params provided)
 */
function renderSearchForm(json, req) {
  const resourceType = getSearchResourceType(json);
  const params = resourceType === 'CodeSystem' ? CODESYSTEM_PARAMS : SEARCH_PARAMS;
  
  let html = '<div class="alert alert-info">Enter search criteria:</div>';
  html += `<form method="get" action="${escapeHtml(req.baseUrl)}/${escapeHtml(resourceType)}">`;
  html += '<div class="row">';
  
  // Build form fields
  for (const param of params) {
    html += '<div class="col-md-4 mb-3">';
    html += `<label for="${param.name}" class="form-label">${escapeHtml(param.label)}</label>`;
    
    if (param.type === 'select') {
      html += `<select name="${param.name}" id="${param.name}" class="form-select">`;
      for (const opt of param.options) {
        html += `<option value="${escapeHtml(opt)}">${escapeHtml(opt || '(any)')}</option>`;
      }
      html += '</select>';
    } else {
      html += `<input type="text" name="${param.name}" id="${param.name}"/>`;
    }
    
    html += '</div>';
  }
  
  html += '</div>';
  
  // Sort dropdown
  html += '<div class="row">';
  html += '<div class="col-md-4 mb-3">';
  html += '<label for="_sort" class="form-label">Sort By</label>';
  html += '<select name="_sort" id="_sort" class="form-select">';
  for (const opt of SORT_OPTIONS) {
    html += `<option value="${escapeHtml(opt)}">${escapeHtml(opt || '(default)')}</option>`;
  }
  html += '</select>';
  html += '</div>';
  html += '</div>';
  
  // Elements checkboxes
  html += '<div class="mb-3">';
  html += '<label class="form-label">Elements to include:</label><br/>';
  for (const elem of ELEMENT_OPTIONS) {
    html += `<div class="form-check form-check-inline">`;
    html += `<input type="checkbox" name="_elements" value="${escapeHtml(elem)}" id="elem_${elem}" class="form-check-input"/>`;
    html += `<label for="elem_${elem}" class="form-check-label">${escapeHtml(elem)}</label>`;
    html += '</div>';
  }
  html += '</div>';
  
  html += '<button type="submit" class="btn btn-primary">Search</button>';
  html += '</form>';
  
  return html;
}

/**
 * Get resource type from search bundle (from self link or first entry)
 */
function getSearchResourceType(json) {
  // Try to get from self link first
  const selfLink = json.link?.find(l => l.relation === 'self')?.url || '';
  const typeMatch = selfLink.match(/\/(CodeSystem|ValueSet|ConceptMap)\?/);
  if (typeMatch) {
    return typeMatch[1];
  }
  
  // Fall back to first entry
  const firstEntry = json.entry?.[0]?.resource;
  return firstEntry?.resourceType || 'Resource';
}

/**
 * Render search results as a table (when _elements is specified)
 */
function renderSearchTable(json, elements, req) {
  const entries = json.entry || [];
  const total = json.total || 0;
  
  let html = `<p>Found ${total} result(s)</p>`;
  
  // Pagination links
  html += renderPaginationLinks(json);
  
  // Build table
  html += '<table class="table table-striped grid">';
  html += '<thead><tr>';
  html += '<th>ID</th>';
  for (const elem of elements) {
    if (elem !== 'id') {
      html += `<th>${escapeHtml(elem)}</th>`;
    }
  }
  html += '</tr></thead>';
  html += '<tbody>';
  
  for (const entry of entries) {
    const resource = entry.resource;
    if (!resource) continue;
    
    html += '<tr>';
    
    // ID column with link
    const id = resource.id || '';
    const resourceType = resource.resourceType || '';
    html += `<td><a href="${escapeHtml(req.baseUrl)}/${escapeHtml(resourceType)}/${escapeHtml(id)}">${escapeHtml(id)}</a></td>`;
    
    // Other element columns
    for (const elem of elements) {
      if (elem !== 'id') {
        const value = resource[elem];
        html += `<td>${escapeHtml(formatValue(value))}</td>`;
      }
    }
    
    html += '</tr>';
  }
  
  html += '</tbody></table>';
  
  // Pagination links again at bottom
  html += renderPaginationLinks(json);
  
  return html;
}

/**
 * Render search results as summary with individual resources
 */
function renderSearchSummary(json, req) {
  const entries = json.entry || [];
  const total = json.total || 0;
  
  let html = `<p>Found ${total} result(s)</p>`;
  
  // Pagination links
  html += renderPaginationLinks(json);
  
  // Bundle summary
  html += '<div class="card mb-3">';
  html += '<div class="card-header">Bundle Summary</div>';
  html += '<div class="card-body">';
  html += `<p><strong>Type:</strong> ${escapeHtml(json.type)}</p>`;
  html += `<p><strong>Total:</strong> ${total}</p>`;
  html += '</div>';
  html += '</div>';
  
  // Each entry
  for (const entry of entries) {
    html += '<hr/>';
    
    if (entry.resource) {
      const resource = entry.resource;
      html += `<h4>${escapeHtml(resource.resourceType)}/${escapeHtml(resource.id || 'unknown')}</h4>`;
      
      if (entry.fullUrl) {
        html += `<p><small><a href="${escapeHtml(entry.fullUrl)}">${escapeHtml(entry.fullUrl)}</a></small></p>`;
      }
      
      // Render the resource
      html += render(resource, req);
    }
  }
  
  // Pagination links again at bottom
  html += renderPaginationLinks(json);
  
  return html;
}

/**
 * Render pagination links
 */
function renderPaginationLinks(json) {
  const links = json.link || [];
  if (links.length === 0) return '';
  
  let html = '<nav><ul class="pagination">';
  
  const linkOrder = ['first', 'previous', 'self', 'next', 'last'];
  
  for (const rel of linkOrder) {
    const link = links.find(l => l.relation === rel);
    if (link) {
      const isDisabled = rel === 'self';
      const label = rel.charAt(0).toUpperCase() + rel.slice(1);
      
      if (isDisabled) {
        html += `<li class="page-item active"><span class="page-link">${escapeHtml(label)}</span></li>`;
      } else {
        html += `<li class="page-item"><a class="page-link" href="${escapeHtml(link.url)}">${escapeHtml(label)}</a></li>`;
      }
    }
  }
  
  html += '</ul></nav>';
  return html;
}

/**
 * Render a generic bundle (non-search)
 */
function renderGenericBundle(json, req) {
  let html = '<div class="card mb-3">';
  html += '<div class="card-header">Bundle</div>';
  html += '<div class="card-body">';
  html += `<p><strong>Type:</strong> ${escapeHtml(json.type)}</p>`;
  html += `<p><strong>Total:</strong> ${json.total || 'N/A'}</p>`;
  html += '</div>';
  html += '</div>';
  
  // Links
  if (json.link && json.link.length > 0) {
    html += '<h4>Links</h4>';
    html += '<ul>';
    for (const link of json.link) {
      html += `<li><strong>${escapeHtml(link.relation)}:</strong> <a href="${escapeHtml(link.url)}">${escapeHtml(link.url)}</a></li>`;
    }
    html += '</ul>';
  }
  
  // Entries
  if (json.entry && json.entry.length > 0) {
    for (const entry of json.entry) {
      html += '<hr/>';
      if (entry.resource) {
        html += render(entry.resource, req);
      }
    }
  }
  
  return html;
}

/**
 * Render generic resource (fallback)
 */
function renderGeneric(json) {
  return `<pre>${escapeHtml(JSON.stringify(json, null, 2))}</pre>`;
}

/**
 * Format a value for display
 */
function formatValue(value) {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'object') {
    return JSON.stringify(value);
  }
  return String(value);
}

module.exports = {
  loadTemplate,
  render,
  renderPage,
  buildTitle,
  acceptsHtml,
  escapeHtml,
  
  // Individual renderers for potential future customization
  renderParameters,
  renderCodeSystem,
  renderValueSet,
  renderConceptMap,
  renderCapabilityStatement,
  renderBundle,
  renderOperationOutcome,
  renderGeneric
};
