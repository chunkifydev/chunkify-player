import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const publishScript = path.join(repositoryRoot, "bin/publish-npm");

async function runPublish(releaseTag) {
  const directory = await mkdtemp(path.join(tmpdir(), "chunkify-publish-test-"));
  const mockBin = path.join(directory, "bin");
  const npmLog = path.join(directory, "npm.log");
  await mkdir(mockBin);
  for (const workspace of ["player", "player-react"]) {
    const packageDirectory = path.join(directory, "packages", workspace);
    await mkdir(packageDirectory, { recursive: true });
    await writeFile(path.join(packageDirectory, "package.json"), JSON.stringify({
      name: `@chunkify/${workspace}`,
      version: "1.0.0",
    }));
  }

  const mockNpm = path.join(mockBin, "npm");
  await writeFile(mockNpm, `#!/usr/bin/env bash
echo "$*" >> "$MOCK_NPM_LOG"
if [[ "$1" == "view" ]]; then
  echo "npm error code E404" >&2
  exit 1
fi
if [[ "$1" == "publish" ]]; then
  exit 0
fi
exit 2
`);
  await chmod(mockNpm, 0o755);

  const result = spawnSync("bash", [publishScript], {
    cwd: directory,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${mockBin}:${process.env.PATH}`,
      MOCK_NPM_LOG: npmLog,
      RELEASE_TAG: releaseTag,
    },
  });
  const npmCalls = await readFile(npmLog, "utf8").catch(() => "");

  return { result, npmCalls };
}

test("a player release publishes only the Web Component package", async () => {
  const { result, npmCalls } = await runPublish("player-v1.0.0");

  assert.equal(result.status, 0, result.stderr);
  assert.match(npmCalls, /@chunkify\/player@1\.0\.0/);
  assert.doesNotMatch(npmCalls, /@chunkify\/player-react/);
});

test("a React release publishes only the React package", async () => {
  const { result, npmCalls } = await runPublish("player-react-v1.0.0");

  assert.equal(result.status, 0, result.stderr);
  assert.match(npmCalls, /@chunkify\/player-react@1\.0\.0/);
  assert.doesNotMatch(npmCalls, /@chunkify\/player@1\.0\.0/);
});

test("a manual run publishes missing versions from both packages", async () => {
  const { result, npmCalls } = await runPublish("");

  assert.equal(result.status, 0, result.stderr);
  assert.match(npmCalls, /@chunkify\/player@1\.0\.0/);
  assert.match(npmCalls, /@chunkify\/player-react@1\.0\.0/);
});

test("an unknown release tag does not publish a package", async () => {
  const { result, npmCalls } = await runPublish("v1.0.0");

  assert.equal(result.status, 1);
  assert.match(result.stdout, /Unsupported release tag: v1\.0\.0/);
  assert.equal(npmCalls, "");
});
