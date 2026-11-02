const fs = require("fs");
const path = require("path");
const solc = require("solc");

const contractsDir = path.join(__dirname, "..", "contracts");
const artifactsDir = path.join(__dirname, "..", "artifacts", "contracts");

function getAllSolFiles(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  for (const file of list) {
    const full = path.join(dir, file);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      results = results.concat(getAllSolFiles(full));
    } else if (file.endsWith(".sol")) {
      results.push(full);
    }
  }
  return results;
}

const solFiles = getAllSolFiles(contractsDir);
console.log(`Found ${solFiles.length} contracts to compile.`);

const sources = {};
for (const file of solFiles) {
  const relPath = path.relative(path.join(__dirname, ".."), file).replace(/\\/g, "/");
  sources[relPath] = { content: fs.readFileSync(file, "utf8") };
}

// Find openzeppelin contracts needed
function findImports(importPath) {
  try {
    let targetPath;
    if (importPath.startsWith("@openzeppelin")) {
      targetPath = path.join(__dirname, "..", "node_modules", importPath);
    } else {
      targetPath = path.join(contractsDir, importPath);
    }
    if (fs.existsSync(targetPath)) {
      return { contents: fs.readFileSync(targetPath, "utf8") };
    }
  } catch (e) {}
  return { error: `File not found: ${importPath}` };
}

const input = {
  language: "Solidity",
  sources,
  settings: {
    optimizer: { enabled: true, runs: 200 },
    outputSelection: {
      "*": {
        "*": ["abi", "evm.bytecode.object", "evm.deployedBytecode.object"]
      }
    }
  }
};

console.log("Compiling with local solc...");
const output = JSON.parse(solc.compile(JSON.stringify(input), { import: findImports }));

if (output.errors) {
  let hasErrors = false;
  for (const err of output.errors) {
    if (err.severity === "error") {
      console.error(err.formattedMessage);
      hasErrors = true;
    } else {
      console.warn(err.formattedMessage);
    }
  }
  if (hasErrors) {
    process.exit(1);
  }
}

console.log("Compilation successful! Writing artifacts...");

for (const [sourcePath, contractMap] of Object.entries(output.contracts)) {
  for (const [contractName, contractData] of Object.entries(contractMap)) {
    const destDir = path.join(artifactsDir, path.relative("contracts", sourcePath), `${contractName}.json`);
    const parent = path.dirname(destDir);
    if (!fs.existsSync(parent)) {
      fs.mkdirSync(parent, { recursive: true });
    }

    const artifact = {
      _format: "hh-sol-artifact-1",
      contractName,
      sourceName: sourcePath,
      abi: contractData.abi,
      bytecode: "0x" + contractData.evm.bytecode.object,
      deployedBytecode: "0x" + contractData.evm.deployedBytecode.object,
      linkReferences: {},
      deployedLinkReferences: {}
    };

    fs.writeFileSync(destDir, JSON.stringify(artifact, null, 2), "utf8");
    console.log(`Updated artifact: ${contractName}`);
  }
}

console.log("All artifacts updated!");

