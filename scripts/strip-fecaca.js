/* strip-fecaca.js —— 只删掉 2017t3 题目页那 86 笔 #fecaca 荧光笔，其他一笔不动。
 *
 * 【背景 · 鬼影真身，已用截图实测颜色证实】
 *   截图左栏粉红斜杠实测 rgb(254,238,239)。
 *   #fecaca = rgb(254,202,202)，叠 globalAlpha=.32 到白底：
 *     G/B = 202*.32 + 255*.68 = 238  →  rgb(254,238,239)   ✓ 完全吻合
 *   所以那片斜杠就是题目页 86 笔 #fecaca 荧光笔（位置 2~56），
 *   不是渲染 bug、不是画布压扁、不是橡皮失灵 —— 它们本来就在数据里。
 *
 * 【为什么"当时擦掉了、刷新又回来"】
 *   题目页 197 笔时序：位置 2~56 = 86 笔 hl；位置 168~192 = 8 笔 er。
 *   橡皮全在数据末尾，只擦到尾段；开头 86 笔 hl 从来没有对应的橡皮记录。
 *   redraw() 每次刷新按数据重放 → 86 笔原样回来。
 *
 * 【这个脚本做什么】
 *   删掉 question 槽里 tool==='hl' 且 color==='#fecaca' 的笔画，
 *   pen / 钢笔 / 橡皮 / #fde047 荧光笔 全部保留。
 *   先写一份 .bak 备份，再输出清理后的 JSON。
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const SRC = process.argv[2] || path.join(os.tmpdir(), 't3-bak.json');
const TARGET_ID = '2017-text3-mark';
const SLOT = 'question';
const STRIP = { tool: 'hl', color: '#fecaca' };

if (!fs.existsSync(SRC)) { console.error('找不到 ' + SRC); process.exit(1); }
const raw = fs.readFileSync(SRC, 'utf8');
const bak = JSON.parse(raw);
const rec = bak.notes.find(r => r.id === TARGET_ID);
if (!rec || !rec.marks || !rec.marks[SLOT]) { console.error('找不到 ' + TARGET_ID + ' 的 ' + SLOT); process.exit(1); }

const arr = rec.marks[SLOT];
const before = arr.length;
const hit = arr.filter(s => s.tool === STRIP.tool && s.color === STRIP.color);
const keep = arr.filter(s => !(s.tool === STRIP.tool && s.color === STRIP.color));

/* 顺带把笔数分布打出来，方便核对没误删 */
function tally(list) {
  const m = {};
  list.forEach(s => {
    const k = s.tool + (s.color && s.tool === 'hl' ? '(' + s.color + ')' : '');
    m[k] = (m[k] || 0) + 1;
  });
  return m;
}
console.log('槽位 ' + SLOT + '：' + before + ' 笔 → 删除 ' + hit.length + ' 笔 → 剩 ' + keep.length + ' 笔');
console.log('  删前分布: ' + JSON.stringify(tally(arr)));
console.log('  删后分布: ' + JSON.stringify(tally(keep)));
if (hit.length !== 86) console.log('  ⚠ 预期 86 笔，实际 ' + hit.length + ' 笔 —— 请人工确认后再用');

rec.marks[SLOT] = keep;
bak.notes = bak.notes.map(r => r.id === TARGET_ID ? rec : r);

const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
const bakOut = SRC.replace(/\.json$/, '.before-strip-' + stamp + '.json');
fs.writeFileSync(bakOut, raw);
const out = SRC.replace(/\.json$/, '.cleaned.json');
fs.writeFileSync(out, JSON.stringify(bak, null, 1));

console.log('\n原始备份: ' + bakOut);
console.log('清理后:   ' + out);
console.log('\n下一步：把这个 cleaned.json 用主页的【导入】导进去（会覆盖），');
console.log('或者我直接帮你写进浏览器的 IndexedDB —— 你说哪种。');
