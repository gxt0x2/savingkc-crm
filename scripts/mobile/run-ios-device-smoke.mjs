import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "../..");
const harnessDirectory = path.join(repositoryRoot, "tests/ios-device");
const projectPath = path.join(harnessDirectory, "SavingKCDeviceHarness.xcodeproj");
const resultDirectory = path.join(harnessDirectory, "TestResults");
const developmentTeam = process.env.IOS_DEVELOPMENT_TEAM ?? "SSAW2RZTXJ";

function fail(message) {
  console.error(`iOS device smoke test: ${message}`);
  process.exit(1);
}

function commandExists(command) {
  const result = spawnSync("/usr/bin/which", [command], { stdio: "ignore" });
  return result.status === 0;
}

function listDevices() {
  try {
    const output = execFileSync("xcrun", ["xcdevice", "list"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "inherit"],
    });
    return JSON.parse(output);
  } catch {
    fail("could not read Xcode's device list. Open Xcode once and confirm its license and account setup.");
  }
}

function selectDevice(devices) {
  const requestedId = process.env.IOS_DEVICE_ID;
  const requestedName = process.env.IOS_DEVICE_NAME;
  const physicalIPhones = devices.filter(
    (device) =>
      device.simulator === false &&
      device.available === true &&
      device.platform === "com.apple.platform.iphoneos" &&
      device.modelName?.startsWith("iPhone"),
  );

  if (requestedId) {
    return physicalIPhones.find((device) => device.identifier === requestedId);
  }

  if (requestedName) {
    return physicalIPhones.find((device) => device.name === requestedName);
  }

  if (physicalIPhones.length > 1) {
    fail("multiple iPhones are available. Set IOS_DEVICE_NAME or IOS_DEVICE_ID to choose one.");
  }

  return physicalIPhones[0];
}

if (process.platform !== "darwin") {
  fail("this test must run on macOS with Xcode installed.");
}

if (!commandExists("xcodegen")) {
  fail("XcodeGen is required. Install it once with: brew install xcodegen");
}

const device = selectDevice(listDevices());
if (!device) {
  fail("no unlocked, paired iPhone is available. Keep the phone on the same Wi-Fi as this Mac and enable Developer Mode.");
}

console.log(`Running the read-only SavingKC CRM smoke test on ${device.name}...`);

const generation = spawnSync("xcodegen", ["generate", "--spec", "project.yml"], {
  cwd: harnessDirectory,
  stdio: "inherit",
});
if (generation.status !== 0 || !existsSync(projectPath)) {
  fail("XcodeGen could not create the local test project.");
}

const timestamp = new Date().toISOString().replaceAll(":", "-");
const resultPath = path.join(resultDirectory, `SavingKCDeviceHarness-${timestamp}.xcresult`);
const build = spawnSync(
  "xcodebuild",
  [
    "test",
    "-quiet",
    "-project",
    projectPath,
    "-scheme",
    "SavingKCDeviceHarness",
    "-destination",
    `platform=iOS,id=${device.identifier}`,
    "-resultBundlePath",
    resultPath,
    "-allowProvisioningUpdates",
    "-allowProvisioningDeviceRegistration",
    "CODE_SIGN_STYLE=Automatic",
    `DEVELOPMENT_TEAM=${developmentTeam}`,
  ],
  {
    cwd: harnessDirectory,
    stdio: "inherit",
  },
);

if (build.error) {
  fail(build.error.message);
}
if (build.status !== 0) {
  fail(`failed on ${device.name}. Results were saved locally at ${resultPath}`);
}

console.log(`Read-only iPhone smoke test passed on ${device.name}.`);
console.log(`Local result bundle: ${resultPath}`);
