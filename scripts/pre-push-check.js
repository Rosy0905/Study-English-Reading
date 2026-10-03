// 上线前总检查：manifest 完整性 + 数据包齐全 + 路径真实存在
const fs = require("fs");
const path = require("path");
const ROOT = process.cwd();

global.window = undefined;
const src = fs.readFileSync("manifest.js", "utf8");
eval(src + "\nglobal.LIBRARY = LIBRARY;");

let n = 0, note = 0, zuo = 0, fu = 0;
const bad = [];
const missPkg = [];
for (const y in LIBRARY) {
  for (const it of LIBRARY[y]) {
    n++;
    if (it.note) note++; else bad.push(it.id + " 无 note");
    if (it.zuoti) zuo++;
    if (it.fupan) fu++;
    for (const fld of ["note", "zuoti", "fupan"]) {
      const p = it[fld];
      if (!p) continue;
      const real = p.split("?")[0];
      if (!fs.existsSync(path.join(ROOT, real))) {
        bad.push(`${it.id}.${fld} 指向不存在的 ${real}`);
      }
    }
    // 笔记底稿数据包
    const pkg = path.join(ROOT, "assets", "pdfimg", it.id + ".js");
    if (!fs.existsSync(pkg)) missPkg.push(it.id);
  }
}

console.log("篇目总数:", n, "| note:", note, "| zuoti:", zuo, "| fupan:", fu);
console.log("路径不存在:", bad.length);
bad.slice(0, 10).forEach(b => console.log("   " + b));
console.log("数据包缺失:", missPkg.length);
missPkg.slice(0, 10).forEach(b => console.log("   " + b));

// 底稿图
// 注意：manifest 的 underlay 是**数组**（文章页、题目页各一项），
// 不是对象。一开始按对象写，统计出来永远是 0，图路径等于没验证。
let missImg = [];
let imgCount = 0;
for (const y in LIBRARY) {
  for (const it of LIBRARY[y]) {
    const u = it.underlay || [];
    const list = Array.isArray(u) ? u : Object.values(u);
    for (const p of list) {
      if (!p) continue;
      imgCount++;
      if (!fs.existsSync(path.join(ROOT, p))) missImg.push(it.id + " -> " + p);
    }
    // 数组长度应为 2（文章 + 题目）
    if (list.length !== 2) missImg.push(it.id + " underlay 应有 2 项，实际 " + list.length);
  }
}
console.log("底稿图引用:", imgCount, "| 缺失:", missImg.length);
missImg.slice(0, 10).forEach(b => console.log("   " + b));

const ok = !bad.length && !missPkg.length && !missImg.length && n === 68;
console.log(ok ? "\n✅ 总检查通过" : "\n❌ 有问题，先别推");
process.exit(ok ? 0 : 1);
