const yaml = require("yaml")
const git = require("simple-git")
const fs = require("fs")
const wrench = require("wrench")
const tar = require("tar-fs")

var argv = require('minimist')(process.argv.slice(2));

// bom yaml to load as first argument
const bomSource = argv._[0];

const dockerRegistry = argv.registry || argv.r;

console.log(`performing operations on bom ${bomSource}`)

const bom = yaml.parse(fs.readFileSync(bomSource, 'utf8'));

const targetBase = "./build/.boms"

if(!fs.existsSync(targetBase)) fs.mkdirSync(targetBase, {recursive: true})
if(!fs.existsSync("./tmp")) fs.mkdirSync("./tmp")

Promise.all(Object.keys(bom.services).map(async key => {

  // skip specific bom entries
  switch (key) {
    case "defaultArtifact":
    case "monitoring-third-party":
    case "monitoring-daemon":
      return;
  }7

  const val = bom.services[key];

  console.log(`processing ${bom.artifactSources.gitPrefix}/${key} ${val.commit}`)
  await new Promise((res, rej) => {
    const path = `./tmp/${key}`
    try {
      if (fs.existsSync(path)) {
        console.log("repository found. trying fetch.")
        git(path).fetch(() => {
          git(`./tmp/${key}`).checkout(val.commit, () => {
            res();
          });
        })
      } else {
        console.log("cloning repository.")
        git().clone(`${bom.artifactSources.gitPrefix}/${key}`, `./tmp/${key}`, () => {
          git(`./tmp/${key}`).checkout(val.commit, () => {
            res();
          });
        });
      }
    } catch (err) {
      rej(err);
    }
  });

  
  console.log("checkout complete.")
  const target = `${targetBase}/${key}/${val.version}/`

  fs.mkdirSync(target, {recursive: true})
  
  console.log(`copy ${key} to ${target}`)
  wrench.copyDirSyncRecursive(`./tmp/${key}/halconfig`, target, {
    forceDelete: true,
    inflateSymlinks: true
  });

  // remap version to local
  bom.services[key].version = `local:${bom.services[key].version}`
})).then(() => {

  if (dockerRegistry) {
    bom.artifactSources.dockerRegistry = dockerRegistry;
  }

  console.log("write custom bom...")
  fs.mkdirSync(`${targetBase}/bom/`, { recursive: true })
  fs.writeFileSync(`${targetBase}/bom/${bom.version}.yml`, yaml.stringify(bom))

  console.log("packing files")
  tar.pack('build', {
    entries: ['.boms']
  }).pipe(fs.createWriteStream('./build/boms.tar'))
});