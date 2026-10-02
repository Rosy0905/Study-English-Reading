/* ================================================================
   ekz-pdf.js · 极简 PDF 生成器（无依赖）
   EkzPdf.build([canvas,...]) → Promise<Blob>
   每页一张图（JPEG 有损压缩），页面尺寸=canvas CSS 尺寸换算成 pt
   ================================================================ */
(function () {
  'use strict';

  function jpegBytes(canvas, quality) {
    const url = canvas.toDataURL('image/jpeg', quality || 0.92);
    const b64 = url.split(',')[1];
    const bin = atob(b64);
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return u8;
  }

  function build(canvases) {
    const enc = new TextEncoder();
    const parts = [];           /* {data:Uint8Array|string} */
    let offset = 0;
    const offs = {};            /* objId -> byte offset */
    const push = d => {
      const u8 = typeof d === 'string' ? enc.encode(d) : d;
      parts.push(u8); offset += u8.length;
    };
    const n = canvases.length;
    /* 对象编号：1=Catalog 2=Pages，每页三个对象（Page/Contents/Image） */
    const pageId = i => 3 + i * 3, contId = i => 4 + i * 3, imgId = i => 5 + i * 3;

    push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');

    const kids = [];
    for (let i = 0; i < n; i++) {
      const cv = canvases[i];
      const W = +(cv.width / 96 * 72).toFixed(2), H = +(cv.height / 96 * 72).toFixed(2);
      const jpg = jpegBytes(cv);
      offs[pageId(i)] = offset;
      push(pageId(i) + ' 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + W + ' ' + H + '] ' +
        '/Contents ' + contId(i) + ' 0 R /Resources << /XObject << /Im0 ' + imgId(i) + ' 0 R >> /ProcSet [/PDF /ImageC] >> >>\nendobj\n');
      const content = 'q ' + W + ' 0 0 ' + H + ' 0 0 cm /Im0 Do Q\n';
      offs[contId(i)] = offset;
      push(contId(i) + ' 0 obj\n<< /Length ' + content.length + ' >>\nstream\n' + content + 'endstream\nendobj\n');
      offs[imgId(i)] = offset;
      push(imgId(i) + ' 0 obj\n<< /Type /XObject /Subtype /Image /Width ' + cv.width + ' /Height ' + cv.height +
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

    const total = parts.reduce((a, p) => a + (p.length || p.byteLength), 0);
    const out = new Uint8Array(total);
    let at = 0;
    for (const p of parts) {
      const u8 = typeof p === 'string' ? enc.encode(p) : p;
      out.set(u8, at); at += u8.length;
    }
    return Promise.resolve(new Blob([out], { type: 'application/pdf' }));
  }

  function download(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }

  window.EkzPdf = { build, download };
})();
