import { readdirSync, readFileSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import * as ts from 'typescript';

const PRODUCTION_ROOT = resolve(__dirname, '../..');
const RETIRED_IDENTIFIERS = new Set([
  'syncIncludeSubWikis',
  'remoteWorkspaceId',
  'relayRequiredForOnline',
]);
const RELAY_COORDINATOR = resolve(PRODUCTION_ROOT, 'services/DeviceNetworkService/cloudCoordinator.ts');

type LegacyReference = {
  filePath: string;
  kind: string;
  name: string;
};

function productionFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const filePath = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      // Test-only source may mention retired fields as fixtures or assertions.
      return entry.name === '__tests__' ? [] : productionFiles(filePath);
    }
    if (!entry.isFile() || !['.ts', '.tsx'].includes(extname(entry.name)) || /\.test\.[^.]+$/u.test(entry.name)) {
      return [];
    }
    return [filePath];
  });
}

function propertyName(node: ts.PropertyName): string | undefined {
  return ts.isIdentifier(node) || ts.isStringLiteralLike(node) ? node.text : undefined;
}

function findLegacyReferences(filePath: string): LegacyReference[] {
  const source = readFileSync(filePath, 'utf8');
  const sourceFile = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    extname(filePath) === '.tsx' ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const references: LegacyReference[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && RETIRED_IDENTIFIERS.has(node.text)) {
      references.push({ filePath, kind: 'identifier', name: node.text });
    }
    if (ts.isStringLiteralLike(node) && RETIRED_IDENTIFIERS.has(node.text)) {
      references.push({ filePath, kind: 'string literal', name: node.text });
    }
    if (ts.isPropertyAssignment(node) && propertyName(node.name) === 'migrate') {
      references.push({ filePath, kind: 'persist migrate property', name: 'migrate' });
    }
    if (
      ts.isPropertyAssignment(node) &&
      propertyName(node.name) === 'version' &&
      ts.isNumericLiteral(node.initializer) &&
      node.initializer.text === '2'
    ) {
      references.push({ filePath, kind: 'persist version literal', name: 'version' });
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return references;
}

describe('retired workspace and relay fields stay absent', () => {
  it('scans the complete production tree with the TypeScript AST', () => {
    const references = productionFiles(PRODUCTION_ROOT).flatMap(findLegacyReferences);
    const relayReferences = references.filter(reference => reference.name === 'relayRequiredForOnline');
    const invalidReferences = references.filter(reference => (
      reference.name !== 'relayRequiredForOnline' || resolve(reference.filePath) !== RELAY_COORDINATOR
    ));

    expect(invalidReferences).toEqual([]);
    expect(relayReferences).toHaveLength(2);
    expect(relayReferences.every(reference => resolve(reference.filePath) === RELAY_COORDINATOR)).toBe(true);
  });

  it('keeps relayRequiredForOnline owned by the mobile coordinator wrapper', () => {
    const coordinatorReferences = findLegacyReferences(RELAY_COORDINATOR)
      .filter(reference => reference.name === 'relayRequiredForOnline');
    expect(coordinatorReferences).toHaveLength(2);
    expect(coordinatorReferences.some(reference => reference.kind === 'identifier')).toBe(true);
  });

  it('round-trips canonical persisted payloads without retired fields', () => {
    const payload = {
      workspace: { id: 'workspace-1', syncedServers: [] },
      server: { id: 'server-1', workspaceId: 'workspace-1', status: 'disconnected' },
    };
    const restored = JSON.parse(JSON.stringify(payload)) as typeof payload;

    expect(restored).toStrictEqual(payload);
    expect(restored.workspace).not.toHaveProperty('syncIncludeSubWikis');
    expect(restored.server).not.toHaveProperty('remoteWorkspaceId');
  });
});
