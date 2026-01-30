const fs = require('fs');
const path = require('path');
const { PackageManager} = require("../../library/package-manager");
const {txTestModeSet} = require("../../tx/test-runner");

const OUTPUT_FILE = path.join(__dirname, 'test-cases.test.js');

// we generate the skeleton of the tests so that we have a stable set of tests
// for useability in jest etc. We haven't ported all the test code - that can
// stay in the java validator. We actually execute the test cases by loading
// the java validator in server mode, and then using it to actually execute
// the tests
let npm;
let testCases;

// async function load() {
//     const packageServers = ['https://packages2.fhir.org/packages'];
//     const cacheFolder = path.join(__dirname, '..', '..', '.package-cache');
//     const packageManager = new PackageManager(packageServers, cacheFolder);
//     const packagePath = await packageManager.fetch("hl7.fhir.uv.tx-ecosystem");
//     const fullPackagePath = path.join(cacheFolder, packagePath);
//     npm = JSON.parse(fs.readFileSync(path.join(fullPackagePath, "package", "package.json"), 'utf8'));
//     testCases = JSON.parse(fs.readFileSync(path.join(fullPackagePath, "package", "tests", "test-cases.json"), 'utf8'));
// }
//
// function generate() {
//     const modes = txTestModeSet();
//
//     let output = `// AUTO-GENERATED FILE - DO NOT EDIT
// // Generated from test-cases.json
// // Regenerate with: node generate-tests.js
//
// const { runTest, startTxTests, finishTxTests } = require('../../tx/test-runner');
//
// function txTestVersion() {
//   return '${npm.version}';
// }
//
// describe('Tx Tests', () => {
//
//   beforeAll(async () => {
//     await startTxTests();
//   }, 600000);
//   afterAll(async () => {
//     await finishTxTests();
//   });
// `;
//
//     for (const suite of testCases.suites) {
//         if (!suite.mode || modes.has(suite.mode)) {
//             output += `describe('${suite.name}', () => {\n`;
//
//             if (suite.description) {
//                 output += `  // ${suite.description}\n\n`;
//             }
//
//             for (const test of suite.tests) {
//                 if (!test.mode || modes.has(test.mode)) {
//                     let testDetails = {
//                         suite: suite.name,
//                         test: test.name
//                     }
//
//                     const escapedName = test.name.replace(/'/g, "\\'");
//                     output += `  it('${escapedName}', async () => {\n`;
//                     output += `    await runTest(${JSON.stringify(testDetails)});\n`;
//                     output += `  });\n\n`;
//                 }
//             }
//             output += `});\n\n`;
//         }
//     }
//     output += `});\n\n
// module.exports = { txTestVersion };
// `;
//     fs.writeFileSync(OUTPUT_FILE, output);
//     console.log(`Generated ${OUTPUT_FILE}`);
// }

describe('Generate Test Cases', () => {
    test('Do Generation', async () => {
        // await load();
        // generate();
        expect(true).toBeTruthy();
    });
 }
);