import { basename } from "node:path";
import { delimiter } from "node:path";
import { dirname } from "node:path";
import { extname } from "node:path";
import { homedir } from "node:os";
import { isAbsolute } from "node:path";
import { join } from "node:path";
import { normalize as normalize$1 } from "node:path";
import { relative } from "node:path";
import { resolve } from "node:path";
import { sep } from "node:path";
import { tmpdir } from "node:os";

function getConfigDir() {
  const override = process.env["ZEROWORK_CONFIG_DIR"];
  return override !== void 0 && override !== "" ? override : join(homedir(), ".zerowork");
}

function getAuthPath() {
  return join(getConfigDir(), "auth.json");
}

function getModelsPath() {
  return join(getConfigDir(), "models.json");
}

function getModelsStorePath() {
  return join(getConfigDir(), "models-store.json");
}

function getSessionsDir() {
  return join(getConfigDir(), "sessions");
}

function getAutomationsFile() {
  return join(getConfigDir(), "automations.json");
}

function getArchiveFile() {
  return join(getConfigDir(), "archive.json");
}

function getMcpConfigPath() {
  return join(getConfigDir(), "mcp.json");
}

function getResourcesDir() {
  const override = process.env["ZEROWORK_RESOURCES_DIR"];
  return override !== void 0 && override !== "" ? override : resolve(import.meta.dirname, "..", "..", "resources");
}

function getBuiltinSkillDirs() {
  const resources = getResourcesDir();
  return [join(resources, "skills"), join(resources, "plugins")];
}

function getAppDir() {
  const override = process.env["ZEROWORK_APP_DIR"];
  return override !== void 0 && override !== "" ? override : resolve(import.meta.dirname, "..", "..");
}

function getWorkspaceDir() {
  const override = process.env["ZEROWORK_WORKSPACE_DIR"];
  return override !== void 0 && override !== "" ? override : join(homedir(), "ZeroWork");
}

function getSpillsDir(cwd) {
  return join(cwd, ".zerowork", "spills");
}

function getRuntimesDir() {
  return join(getConfigDir(), "runtimes");
}

function getTempTasksDir(root) {
  return join(root, "临时任务");
}

export {
	getAppDir,
	getArchiveFile,
	getAuthPath,
	getAutomationsFile,
	getBuiltinSkillDirs,
	getConfigDir,
	getMcpConfigPath,
	getModelsPath,
	getModelsStorePath,
	getResourcesDir,
	getRuntimesDir,
	getSessionsDir,
	getSpillsDir,
	getTempTasksDir,
	getWorkspaceDir,
};