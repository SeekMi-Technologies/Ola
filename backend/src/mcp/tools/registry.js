// Ola CRM MCP — Tool registry (A4)
//
// Auto-discovers tool modules from sibling directories `crud/` and `compute/`,
// and registers them on a freshly created McpServer instance.
//
// Tool module contract (each .js file under crud/ or compute/):
//   module.exports = {
//     name:        string,           // e.g. 'customer.search' — MCP tool id
//     description: string,           // human-readable, shown in tools/list
//     inputSchema: ZodRawShape | {}, // zod raw shape object (or {} for no input)
//     handler:     async (input) => ({ ok, data?, code?, message? }),
//   }
//
// A module may also export an array of tools, or `{ tools: [...] }`, to allow
// grouping (e.g. all 4 customer tools in one file).
//
// The handler returns our unified envelope `{ ok, data?, code?, message? }`.
// This registry wraps it into the MCP `content` shape — keeping tool authors
// free of MCP transport concerns.
//
// Files starting with `_` are skipped (reserved for shared helpers / drafts).

const fs = require('fs');
const path = require('path');

const TOOL_DIRS = ['crud', 'compute'];

function loadToolsFromDir(absDir) {
  if (!fs.existsSync(absDir)) return [];
  const out = [];
  for (const file of fs.readdirSync(absDir)) {
    if (!file.endsWith('.js')) continue;
    if (file.startsWith('_')) continue;
    const full = path.join(absDir, file);
    // eslint-disable-next-line global-require, import/no-dynamic-require
    const mod = require(full);
    out.push(...normalizeExport(mod, full));
  }
  return out;
}

function normalizeExport(mod, filePath) {
  if (!mod) {
    throw new Error(`[mcp registry] ${filePath} exports nothing`);
  }
  if (Array.isArray(mod)) return mod;
  if (Array.isArray(mod.tools)) return mod.tools;
  if (mod.name && typeof mod.handler === 'function') return [mod];
  throw new Error(
    `[mcp registry] ${filePath} must export a tool, an array of tools, or {tools:[...]}`,
  );
}

function discover() {
  const base = __dirname;
  const all = [];
  for (const sub of TOOL_DIRS) {
    all.push(...loadToolsFromDir(path.join(base, sub)));
  }
  // Validate uniqueness early — duplicate names are a programmer error.
  const seen = new Set();
  for (const t of all) {
    if (!t.name || typeof t.name !== 'string') {
      throw new Error(`[mcp registry] tool missing name: ${JSON.stringify(t)}`);
    }
    if (typeof t.handler !== 'function') {
      throw new Error(`[mcp registry] tool ${t.name} missing handler function`);
    }
    if (seen.has(t.name)) {
      throw new Error(`[mcp registry] duplicate tool name: ${t.name}`);
    }
    seen.add(t.name);
  }
  return all;
}

/**
 * Register every discovered tool on the given McpServer instance.
 * Returns the number of tools registered.
 *
 * Wraps each handler so that:
 *   - input is forwarded as-is
 *   - { ok, data, ... } envelope becomes a JSON text content block
 *   - { ok: false } is surfaced via the MCP `isError` flag (NanoBot expects this)
 *   - thrown errors translate to a uniform INTERNAL envelope, never silently swallowed
 */
// DeepSeek requires tool names to match ^[a-zA-Z0-9_-]+$. Our canonical
// names use dots (e.g. "customer.search") for readability.  Sanitize at
// registration time so the wire name is always provider-compatible.
function sanitizeName(name) {
  return name.replace(/[^a-zA-Z0-9_-]/g, '_');
}

function registerAll(server) {
  const tools = discover();
  for (const tool of tools) {
    server.registerTool(
      sanitizeName(tool.name),
      {
        title: tool.title || tool.name,
        description: tool.description || '',
        inputSchema: tool.inputSchema || {},
      },
      async (input) => {
        let envelope;
        try {
          envelope = await tool.handler(input || {});
          if (!envelope || typeof envelope !== 'object' || typeof envelope.ok !== 'boolean') {
            throw new Error(
              `tool ${tool.name} returned malformed envelope (missing ok:boolean)`,
            );
          }
        } catch (err) {
          envelope = {
            ok: false,
            code: 'INTERNAL',
            message: (err && err.message) || String(err),
          };
        }
        return {
          content: [{ type: 'text', text: JSON.stringify(envelope) }],
          isError: envelope.ok === false,
        };
      },
    );
  }
  return tools.length;
}

module.exports = { registerAll, discover };
