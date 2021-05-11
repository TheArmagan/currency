const {existsSync, promises: { mkdir: fsMkdir, writeFile, unlink, readdir, readFile }} = require("fs");
const {resolve} = require("path");
const got = require("got").default;
const parallelLimit = require("run-parallel-limit");
const chillout = require("chillout");

const startTime = Date.now();

const CURRENCY_REGEX = /<Cube currency='(\S+?)' rate='([\d.]+?)'\/>/gm;
const UPDATE_DATE_REGEX = /<Cube time='([\d-]+?)'>/m;
const DATA_URL = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml";

let DATA_DIR = resolve("./api");

(async () => {
  try {
    await rmdir(DATA_DIR);
  } catch {}
  await mkdir(DATA_DIR);

  let body = await got({
    method: "get",
    url: DATA_URL,
    throwHttpErrors: false,
    resolveBodyOnly: true
  });

  let currencyData = parseCurrencies(body);
  let updateDate = parseUpdateDate(body);
  let checkDate = Date.now();

  /**
   * @type {((cb:()=>{})=>{})[]}
   */
  let fileTasks = [];

  fileTasks.push(async (cb) => {
    await writeDataFile("update-date.txt", String(updateDate));
    await writeDataFile("update-date.json", JSON.stringify({value: updateDate},null,2));
    cb();
  });

  fileTasks.push(async (cb) => {
    await writeDataFile("check-date.txt", String(checkDate));
    await writeDataFile("check-date.json", JSON.stringify({value: checkDate},null,2));
    cb();
  });

  await chillout.repeat(currencyData.length, async (fromIndex) => {
    let from = currencyData[fromIndex];
    await chillout.repeat(currencyData.length, async (toIndex) => {
      toIndex = (currencyData.length-1) - toIndex;
      let to = currencyData[toIndex];
      fileTasks.push(async (cb) => {
        let value = fromTo(from[1], to[1]);
        await writeDataFile(`${from[0]}-to-${to[0]}.txt`, `${value}`);
        await writeDataFile(`${from[0]}-to-${to[0]}.json`, JSON.stringify({value: value, updateDate, checkDate},null,2));
        cb();
      })
    });

    fileTasks.push(async (cb) => {
      let values = currencyData.map(i=>([i[0], fromTo(from[1], i[1])]));
      await writeDataFile(`${from[0]}-to-ALL.json`, JSON.stringify({
        updateDate,
        from: from[0],
        to: Object.fromEntries(values),
        checkDate
      },null,2));
      let textVersion = `base=${from[0]}\n`;
      textVersion += `updateDate=${updateDate}\n`;
      textVersion += `checkDate=${checkDate}\n`;
      textVersion += values.map(i => `${i[0]}=${i[1]}`).join("\n");
      await writeDataFile(`${from[0]}-to-ALL.txt`, textVersion);
      cb();
    })
  });

  await (new Promise(r => {
    parallelLimit(fileTasks, 16, r);
  }));

  const endTime = Date.now();
  console.log(`Update finished! Took ${((endTime - startTime) / 1000).toFixed(4)} seconds!`);

  process.exit(0);
})();

function fromTo(from, to) {
  return to / from;
}

/**
 * @param {string} d 
 * @returns {[string,number][]}
 */
function parseCurrencies(d = "") {
  let matches = Array.from(d.matchAll(CURRENCY_REGEX));
  let result = matches.map(i => {
    return ([i[1], `${parseFloat(i[2])}`]);
  });
  return result;
}

/**
 * @param {string} d 
 * @returns {number}
 */
function parseUpdateDate(d = "") {
  return Number(new Date(UPDATE_DATE_REGEX.exec(d)[1]));
}

async function mkdir(dir) {
  if (!existsSync(dir)) await fsMkdir(dir, { recursive: true });
}

async function rmdir(dir) {
  if (!existsSync(dir)) return;
  let fileNames = readdir(dir, "utf-8");
  let tasks = [];
  await chillout.forEach(fileNames, async (fileName) => {
    tasks.push(async (cb) => {
      await unlink(resolve(dir, fileName));
      cb();
    })
  });
  await (new Promise(r => {
    parallelLimit(tasks, 16, r);
  }));
  await unlink(dir);
}

/**
 * @param {string} name 
 * @param {string} data 
 */
async function writeDataFile(name, data) {
  await writeFile(resolve(DATA_DIR, name), data, "utf-8");
}