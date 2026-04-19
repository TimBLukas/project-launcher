import * as assert from 'assert';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { ProjectTypeDetector } from '../projectTypeDetector';

suite('ProjectTypeDetector', () => {
	const tempDirectories: string[] = [];

	async function createTempDirectory(name: string): Promise<string> {
		const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), `project-launcher-detector-${name}-`));
		tempDirectories.push(tempDirectory);
		return tempDirectory;
	}

	teardown(async () => {
		await Promise.all(tempDirectories.map((directory) => fs.rm(directory, { recursive: true, force: true })));
		tempDirectories.length = 0;
	});

	test('honors maxScanDirectories budget', async () => {
		const detector = new ProjectTypeDetector();
		const rootDirectory = await createTempDirectory('budget');
		const firstDirectory = path.join(rootDirectory, 'first');
		const secondDirectory = path.join(rootDirectory, 'second');
		await fs.mkdir(firstDirectory, { recursive: true });
		await fs.mkdir(secondDirectory, { recursive: true });
		await fs.writeFile(path.join(secondDirectory, 'requirements.txt'), 'django', 'utf8');

		const constrainedResult = await detector.detect(rootDirectory, {
			maxDepth: 2,
			maxScanDirectories: 1,
			skipDirectories: [],
			useCache: false,
			cacheTtlMs: 300000
		});
		assert.strictEqual(constrainedResult, 'Generic');

		const relaxedResult = await detector.detect(rootDirectory, {
			maxDepth: 2,
			maxScanDirectories: 10,
			skipDirectories: [],
			useCache: false,
			cacheTtlMs: 300000
		});
		assert.strictEqual(relaxedResult, 'Python');
	});

	test('uses cache when enabled', async () => {
		const detector = new ProjectTypeDetector();
		const rootDirectory = await createTempDirectory('cache');
		await fs.writeFile(path.join(rootDirectory, 'Cargo.toml'), '[package]\nname="sample"', 'utf8');

		const firstResult = await detector.detect(rootDirectory, {
			maxDepth: 1,
			maxScanDirectories: 10,
			skipDirectories: [],
			useCache: true,
			cacheTtlMs: 60000
		});
		assert.strictEqual(firstResult, 'Rust');

		await fs.rm(path.join(rootDirectory, 'Cargo.toml'), { force: true });
		const cachedResult = await detector.detect(rootDirectory, {
			maxDepth: 1,
			maxScanDirectories: 10,
			skipDirectories: [],
			useCache: true,
			cacheTtlMs: 60000
		});
		assert.strictEqual(cachedResult, 'Rust');

		const uncachedResult = await detector.detect(rootDirectory, {
			maxDepth: 1,
			maxScanDirectories: 10,
			skipDirectories: [],
			useCache: false,
			cacheTtlMs: 60000
		});
		assert.strictEqual(uncachedResult, 'Generic');
	});
});
