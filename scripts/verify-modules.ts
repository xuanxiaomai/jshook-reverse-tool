import { access, readFile } from 'node:fs/promises';
import path from 'node:path';

type VerifyResult = {
  ok: boolean;
  checked: string[];
  missing: string[];
};

type PackageJsonShape = {
  main?: string;
  bin?: string | Record<string, string>;
};

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function normalizeOutputPaths(pkg: PackageJsonShape): string[] {
  const outputs = new Set<string>();

  if (pkg.main) {
    outputs.add(pkg.main);
  }

  if (typeof pkg.bin === 'string') {
    outputs.add(pkg.bin);
  } else if (pkg.bin && typeof pkg.bin === 'object') {
    for (const value of Object.values(pkg.bin)) {
      outputs.add(value);
    }
  }

  return Array.from(outputs);
}

async function verifyBuildOutputs(projectRoot: string): Promise<VerifyResult> {
  const packageJsonPath = path.join(projectRoot, 'package.json');
  const packageJsonRaw = await readFile(packageJsonPath, 'utf-8');
  const packageJson = JSON.parse(packageJsonRaw) as PackageJsonShape;

  const packageOutputs = normalizeOutputPaths(packageJson);
  const requiredOutputs = [
    ...packageOutputs,
    'dist/server/MCPServer.js',
    'dist/server/BrowserToolHandlers.js',
    'dist/server/DebuggerToolHandlers.js',
    'dist/server/AdvancedToolHandlers.js',
  ];

  const checked: string[] = [];
  const missing: string[] = [];

  for (const relativePath of requiredOutputs) {
    const fullPath = path.resolve(projectRoot, relativePath);
    checked.push(relativePath);
    if (!(await fileExists(fullPath))) {
      missing.push(relativePath);
    }
  }

  return {
    ok: missing.length === 0,
    checked,
    missing,
  };
}

async function main(): Promise<void> {
  const projectRoot = process.cwd();
  const result = await verifyBuildOutputs(projectRoot);

  console.log('Verify checked files:');
  for (const file of result.checked) {
    console.log(`  - ${file}`);
  }

  if (!result.ok) {
    console.error('\nVerify failed. Missing build outputs:');
    for (const file of result.missing) {
      console.error(`  - ${file}`);
    }
    process.exit(1);
  }

  console.log('\nVerify passed. Build outputs look good.');
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error('Verify failed with unexpected error:\n', message);
  process.exit(1);
});
