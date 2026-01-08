const NodeType = {
  Document: 'Document',
  Element: 'Element',
  Text: 'Text',
  Comment: 'Comment',
  DocType: 'DocType',
  Instruction: 'Instruction'
};

class XhtmlNode {
  constructor(nodeType, name = null) {
    this.nodeType = nodeType;
    this.name = name;
    this.attributes = new Map();
    this.childNodes = [];
    this.content = null; // for text nodes
    this.inPara = false;
    this.inLink = false;
    this.pretty = true;
  }

  // Attribute methods
  setAttribute(name, value) {
    if (value != null) {
      this.attributes.set(name, value);
    }
    return this;
  }

  attribute(name, value) {
    return this.setAttribute(name, value);
  }

  attr(name, value) {
    return this.setAttribute(name, value);
  }

  getAttribute(name) {
    return this.attributes.get(name) || null;
  }

  hasAttribute(name) {
    return this.attributes.has(name);
  }

  removeAttribute(name) {
    this.attributes.delete(name);
    return this;
  }

  // Class helpers
  clss(className) {
    if (className) {
      const existing = this.attributes.get('class');
      if (existing) {
        this.attributes.set('class', existing + ' ' + className);
      } else {
        this.attributes.set('class', className);
      }
    }
    return this;
  }

  style(style) {
    if (style) {
      this.attributes.set('style', style);
    }
    return this;
  }

  id(id) {
    if (id) {
      this.attributes.set('id', id);
    }
    return this;
  }

  title(title) {
    if (title) {
      this.attributes.set('title', title);
    }
    return this;
  }

  // Child node management
  #makeTag(name) {
    const node = new XhtmlNode(NodeType.Element, name);
    if (this.inPara || name === 'p') {
      node.inPara = true;
    }
    if (this.inLink || name === 'a') {
      node.inLink = true;
    }
    const inlineElements = ['b', 'big', 'i', 'small', 'tt', 'abbr', 'acronym', 'cite', 'code',
      'dfn', 'em', 'kbd', 'strong', 'samp', 'var', 'a', 'bdo', 'br', 'img', 'map', 'object',
      'q', 'script', 'span', 'sub', 'sup', 'button', 'input', 'label', 'select', 'textarea'];
    if (inlineElements.includes(name)) {
      node.pretty = false;
    }
    return node;
  }

  addTag(nameOrIndex, name = null) {
    if (typeof nameOrIndex === 'number') {
      const node = this.#makeTag(name);
      this.childNodes.splice(nameOrIndex, 0, node);
      return node;
    } else {
      const node = this.#makeTag(nameOrIndex);
      this.childNodes.push(node);
      return node;
    }
  }

  addText(content) {
    if (content != null) {
      const node = new XhtmlNode(NodeType.Text);
      node.content = String(content);
      this.childNodes.push(node);
      return node;
    }
    return null;
  }

  addComment(content) {
    if (content != null) {
      const node = new XhtmlNode(NodeType.Comment);
      node.content = content;
      this.childNodes.push(node);
      return node;
    }
    return null;
  }

  addChildren(nodes) {
    if (nodes) {
      for (const node of nodes) {
        this.childNodes.push(node);
      }
    }
    return this;
  }

  addChild(node) {
    if (node) {
      this.childNodes.push(node);
    }
    return this;
  }

  clear() {
    this.childNodes = [];
    return this;
  }

  indexOf(node) {
    return this.childNodes.indexOf(node);
  }

  hasChildren() {
    return this.childNodes.length > 0;
  }

  getFirstElement() {
    for (const child of this.childNodes) {
      if (child.nodeType === NodeType.Element) {
        return child;
      }
    }
    return null;
  }

  // Text content helpers
  tx(content) {
    return this.addText(content);
  }

  txN(content) {
    this.addText(content);
    return this;
  }

  stx(content) {
    if (content) {
      this.addText(' ' + content);
    }
    return this;
  }

  // Fluent element creation methods
  h(level, id = null) {
    if (level < 1 || level > 6) {
      throw new Error('Illegal Header level ' + level);
    }
    const node = this.addTag('h' + level);
    if (id) {
      node.setAttribute('id', id);
    }
    return node;
  }

  h1() { return this.addTag('h1'); }
  h2() { return this.addTag('h2'); }
  h3() { return this.addTag('h3'); }
  h4() { return this.addTag('h4'); }
  h5() { return this.addTag('h5'); }
  h6() { return this.addTag('h6'); }

  div(style = null) {
    const node = this.addTag('div');
    if (style) {
      node.setAttribute('style', style);
    }
    return node;
  }

  span(style = null, title = null) {
    const node = this.addTag('span');
    if (style) {
      node.setAttribute('style', style);
    }
    if (title) {
      node.setAttribute('title', title);
    }
    return node;
  }

  spanClss(className) {
    const node = this.addTag('span');
    if (className) {
      node.setAttribute('class', className);
    }
    return node;
  }

  para() { return this.addTag('p'); }
  p() { return this.addTag('p'); }

  pre(clss = null) {
    const node = this.addTag('pre');
    if (clss) {
      node.setAttribute('class', clss);
    }
    return node;
  }

  blockquote() { return this.addTag('blockquote'); }

  // Lists
  ul() { return this.addTag('ul'); }
  ol() { return this.addTag('ol'); }
  li() { return this.addTag('li'); }

  // Tables
  table(clss = null, forPresentation = false) {
    const node = this.addTag('table');
    if (clss) {
      node.clss(clss);
    }
    if (forPresentation) {
      node.clss('presentation');
    }
    return node;
  }

  tr(afterRow = null) {
    if (afterRow) {
      const index = this.indexOf(afterRow);
      return this.addTag(index + 1, 'tr');
    }
    return this.addTag('tr');
  }

  th(index = null) {
    if (index !== null) {
      return this.addTag(index, 'th');
    }
    return this.addTag('th');
  }

  td(clss = null) {
    const node = this.addTag('td');
    if (clss) {
      node.setAttribute('class', clss);
    }
    return node;
  }

  thead() { return this.addTag('thead'); }
  tbody() { return this.addTag('tbody'); }
  tfoot() { return this.addTag('tfoot'); }

  // Inline elements
  b() { return this.addTag('b'); }
  i() { return this.addTag('i'); }
  em() { return this.addTag('em'); }
  strong() { return this.addTag('strong'); }
  small() { return this.addTag('small'); }
  sub() { return this.addTag('sub'); }
  sup() { return this.addTag('sup'); }

  code(text = null) {
    const node = this.addTag('code');
    if (text) {
      node.tx(text);
    }
    return node;
  }

  codeWithText(preText, text, postText) {
    this.tx(preText);
    const code = this.addTag('code');
    code.tx(text);
    this.tx(postText);
    return this;
  }

  // Line breaks
  br() {
    this.addTag('br');
    return this;
  }

  hr() {
    this.addTag('hr');
    return this;
  }

  // Links
  ah(href, title = null) {
    if (href == null) {
      return this.addTag('span');
    }
    const node = this.addTag('a').setAttribute('href', href);
    if (title) {
      node.setAttribute('title', title);
    }
    return node;
  }

  ahWithText(preText, href, title, text, postText) {
    this.tx(preText);
    const a = this.addTag('a').setAttribute('href', href);
    if (title) {
      a.setAttribute('title', title);
    }
    a.tx(text);
    this.tx(postText);
    return a;
  }

  ahOrCode(href, title = null) {
    if (href != null) {
      return this.ah(href, title);
    } else if (title != null) {
      return this.code().setAttribute('title', title);
    } else {
      return this.code();
    }
  }

  an(name, text = ' ') {
    const a = this.addTag('a').setAttribute('name', name);
    a.tx(text);
    return a;
  }

  // Images
  img(src, alt, title = null) {
    const node = this.addTag('img')
      .setAttribute('src', src)
      .setAttribute('alt', alt || '.');
    if (title) {
      node.setAttribute('title', title);
    }
    return node;
  }

  imgT(src, alt) {
    return this.img(src, alt, alt);
  }

  // Forms
  input(type, name, value = null) {
    const node = this.addTag('input')
      .setAttribute('type', type)
      .setAttribute('name', name);
    if (value != null) {
      node.setAttribute('value', value);
    }
    return node;
  }

  button(text) {
    const node = this.addTag('button');
    node.tx(text);
    return node;
  }

  select(name) {
    return this.addTag('select').setAttribute('name', name);
  }

  option(value, text, selected = false) {
    const node = this.addTag('option').setAttribute('value', value);
    node.tx(text);
    if (selected) {
      node.setAttribute('selected', 'selected');
    }
    return node;
  }

  textarea(name, rows = null, cols = null) {
    const node = this.addTag('textarea').setAttribute('name', name);
    if (rows != null) {
      node.setAttribute('rows', String(rows));
    }
    if (cols != null) {
      node.setAttribute('cols', String(cols));
    }
    return node;
  }

  label(forId) {
    return this.addTag('label').setAttribute('for', forId);
  }

  // Conditional
  iff(test) {
    if (test) {
      return this;
    } else {
      return new XhtmlNode(NodeType.Element, 'span'); // disconnected node
    }
  }

  // Separator helper
  sep(text) {
    if (this.hasChildren()) {
      this.addText(text);
    }
    return this;
  }

  // Rendering
  notPretty() {
    this.pretty = false;
    return this;
  }

  allText() {
    let result = '';
    for (const child of this.childNodes) {
      if (child.nodeType === NodeType.Text) {
        result += child.content || '';
      } else if (child.nodeType === NodeType.Element) {
        result += child.allText();
      }
    }
    return result;
  }

  render(indent = 0, pretty = true) {
    const effectivePretty = pretty && this.pretty;
    const indentStr = effectivePretty ? '  '.repeat(indent) : '';
    const newline = effectivePretty ? '\n' : '';

    if (this.nodeType === NodeType.Text) {
      return this.#escapeHtml(this.content || '');
    }

    if (this.nodeType === NodeType.Comment) {
      return `${indentStr}<!-- ${this.content || ''} -->${newline}`;
    }

    if (this.nodeType === NodeType.Element) {
      const voidElements = ['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
        'link', 'meta', 'param', 'source', 'track', 'wbr'];
      const isVoid = voidElements.includes(this.name);

      let attrs = '';
      for (const [key, value] of this.attributes) {
        attrs += ` ${key}="${this.#escapeAttr(value)}"`;
      }

      if (isVoid) {
        return `${indentStr}<${this.name}${attrs}/>${newline}`;
      }

      if (this.childNodes.length === 0) {
        return `${indentStr}<${this.name}${attrs}></${this.name}>${newline}`;
      }

      // Check if all children are text/inline
      const allInline = this.childNodes.every(c =>
        c.nodeType === NodeType.Text || !c.pretty
      );

      if (allInline || !effectivePretty) {
        let content = '';
        for (const child of this.childNodes) {
          content += child.render(0, false);
        }
        return `${indentStr}<${this.name}${attrs}>${content}</${this.name}>${newline}`;
      } else {
        let content = '';
        for (const child of this.childNodes) {
          content += child.render(indent + 1, true);
        }
        return `${indentStr}<${this.name}${attrs}>${newline}${content}${indentStr}</${this.name}>${newline}`;
      }
    }

    return '';
  }

  #escapeHtml(text) {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  #escapeAttr(text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  toString() {
    return this.render(0, true);
  }

  toStringPretty() {
    return this.render(0, true);
  }

  toStringCompact() {
    return this.render(0, false);
  }
}

// Factory functions
function div(style = null) {
  const node = new XhtmlNode(NodeType.Element, 'div');
  node.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
  if (style) {
    node.setAttribute('style', style);
  }
  return node;
}

function element(name) {
  return new XhtmlNode(NodeType.Element, name);
}

function text(content) {
  const node = new XhtmlNode(NodeType.Text);
  node.content = content;
  return node;
}

function comment(content) {
  const node = new XhtmlNode(NodeType.Comment);
  node.content = content;
  return node;
}

module.exports = {
  XhtmlNode,
  NodeType,
  div,
  element,
  text,
  comment
};
