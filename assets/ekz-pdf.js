/* ================================================================
   ekz-pdf.js · 极简 PDF 生成器（无依赖）
   EkzPdf.build([canvas,...])          → Promise<Blob>   每页一张画布
   EkzPdf.buildFromJpegs([page,...])   → Promise<Blob>   每页已是 JPEG 字节
   EkzPdf.encode(canvas, quality)      → Uint8Array     单张画布转 JPEG

   两种入口的分工：
     build          —— 页数少（做题页批注、笔记页单页），画布留在内存里没关系；
     buildFromJpegs —— 主页整库导出（几十上百页）。画布合成一张就立刻编码成
                       JPEG 丢进来，画布随即释放。原来所有画布攒到最后一次性
                       编码，136 页累计约 2.3GB，标签页直接崩、文件也下不来。
   ================================================================ */
(function () {
  'use strict';

  const A4_SHORT_PT = 595.28;   /* A4 短边（pt） */
  const A4_LONG_PT  = 841.89;   /* A4 长边（pt） */

  function jpegBytes(canvas, quality) {
    const url = canvas.toDataURL('image/jpeg', quality || 0.92);
    const b64 = url.split(',')[1];
    const bin = atob(b64);
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return u8;
  }

  /* 编码走 toBlob：浏览器在后台线程压 JPEG，不卡主线程，
     也省掉 toDataURL 那条 base64 的来回拷贝（几十页时差得很明显）。 */
  function encodeAsync(canvas, quality) {
    return new Promise(res => {
      if (canvas.toBlob) {
        canvas.toBlob(blob => {
          if (!blob) { res(jpegBytes(canvas, quality)); return; }
          blob.arrayBuffer().then(buf => res(new Uint8Array(buf))).catch(() => res(jpegBytes(canvas, quality)));
        }, 'image/jpeg', quality || 0.9);
      } else {
        res(jpegBytes(canvas, quality));
      }
    });
  }

  /* 拼 PDF。pages[i] = { jpeg:Uint8Array, width, height, ptW?, ptH? }
     ptW/ptH 是页面物理尺寸（pt）；不给就按 A4 短边等比换算。
     全程用 Blob 分段拼，不再先拷贝成一个几十 MB 的大数组。 */
  function assemble(pages) {
    const enc = new TextEncoder();
    const parts = [];
    let offset = 0;
    const offs = {};
    const push = d => {
      const u8 = typeof d === 'string' ? enc.encode(d) : d;
      parts.push(u8); offset += u8.length;
    };
    const n = pages.length;
    /* 对象编号：1=Catalog 2=Pages，每页三个对象（Page/Contents/Image） */
    const pageId = i => 3 + i * 3, contId = i => 4 + i * 3, imgId = i => 5 + i * 3;

    push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');

    const kids = [];
    for (let i = 0; i < n; i++) {
      const p = pages[i];
      const ptH = p.ptH || A4_SHORT_PT;
      const ptW = p.ptW || +(ptH * (p.width / p.height)).toFixed(2);
      const jpg = p.jpeg;
      offs[pageId(i)] = offset;
      push(pageId(i) + ' 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + ptW + ' ' + ptH + '] ' +
        '/Contents ' + contId(i) + ' 0 R /Resources << /XObject << /Im0 ' + imgId(i) + ' 0 R >> /ProcSet [/PDF /ImageC] >> >>\nendobj\n');
      /* 图按比例缩到页面里、居中留白，不铺满。铺满会把画布比例和页面比例
         不一致的页拉变形（做题页 0.722 对 A4 的 0.707，差 2% 也看得出来）。 */
      const sc = Math.min(ptW / p.width, ptH / p.height);
      const dw = +(p.width * sc).toFixed(2), dh = +(p.height * sc).toFixed(2);
      const dx = +((ptW - dw) / 2).toFixed(2), dy = +((ptH - dh) / 2).toFixed(2);
      const content = 'q ' + dw + ' 0 0 ' + dh + ' ' + dx + ' ' + dy + ' cm /Im0 Do Q\n';
      offs[contId(i)] = offset;
      push(contId(i) + ' 0 obj\n<< /Length ' + content.length + ' >>\nstream\n' + content + 'endstream\nendobj\n');
      offs[imgId(i)] = offset;
      push(imgId(i) + ' 0 obj\n<< /Type /XObject /Subtype /Image /Width ' + p.width + ' /Height ' + p.height +
        ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + jpg.length + ' >>\nstream\n');
      push(jpg);
      push('\nendstream\nendobj\n');
      kids.push(pageId(i) + ' 0 R');
    }

    offs[1] = offset;
    push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
    offs[2] = offset;
    push('2 0 obj\n<< /Type /Pages /Kids [' + kids.join(' ') + '] /Count ' + n + ' >>\nendobj\n');

    const maxId = 2 + n * 3;
    const xrefPos = offset;
    let xref = 'xref\n0 ' + (maxId + 1) + '\n0000000000 65535 f \n';
    for (let i = 1; i <= maxId; i++) {
      xref += String(offs[i] === undefined ? 0 : offs[i]).padStart(10, '0') + ' 00000 n \n';
    }
    push(xref);
    push('trailer\n<< /Size ' + (maxId + 1) + ' /Root 1 0 R >>\nstartxref\n' + xrefPos + '\n%%EOF');

    return new Blob(parts, { type: 'application/pdf' });
  }

  /* 老入口：画布页。默认按 96dpi 换算（笔记页那种双页并排的纸，页面跟着像素走）；
     opts.a4 为真时页面对齐标准 A4，方向由画布宽高决定 —— 做题页 / 复盘页的
     批注本来就是"一页真题"，对齐 A4 后打印 1:1，不再被打印驱动缩一道。 */
  function build(canvases, opts) {
    opts = opts || {};
    const pages = canvases.map(cv => {
      if (opts.a4) {
        const land = cv.width > cv.height;
        return {
          jpeg: jpegBytes(cv),
          width: cv.width,
          height: cv.height,
          ptW: land ? A4_LONG_PT : A4_SHORT_PT,
          ptH: land ? A4_SHORT_PT : A4_LONG_PT
        };
      }
      return {
        jpeg: jpegBytes(cv),
        width: cv.width,
        height: cv.height,
        ptW: +(cv.width / 96 * 72).toFixed(2),
        ptH: +(cv.height / 96 * 72).toFixed(2)
      };
    });
    return Promise.resolve(assemble(pages));
  }

  function buildFromJpegs(pages) {
    return Promise.resolve(assemble(pages));
  }

  function download(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }

  window.EkzPdf = { build, buildFromJpegs, encode: jpegBytes, encodeAsync, download };
})();
