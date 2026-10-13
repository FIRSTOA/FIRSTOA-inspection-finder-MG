/**
 * 사진 여러 장 → PDF 한 파일(2026-10-14 "5장이면 파일이 5개 — 하나로 모아 달라").
 * 라이브러리 없이 JPEG 를 그대로 넣는 최소 PDF(DCTDecode). 한 장 = 한 쪽, 쪽 폭 595pt(A4 폭)에 비율대로.
 */
async function toJpeg(url: string): Promise<{ bytes: Uint8Array; w: number; h: number }> {
  const img = new Image();
  img.crossOrigin = "anonymous";
  await new Promise<void>((ok, bad) => { img.onload = () => ok(); img.onerror = () => bad(new Error("사진을 불러오지 못했습니다")); img.src = url; });
  const scale = Math.min(1, 2400 / Math.max(img.naturalWidth, img.naturalHeight));   // 너무 큰 사진은 2400px 로
  const w = Math.max(1, Math.round(img.naturalWidth * scale)), h = Math.max(1, Math.round(img.naturalHeight * scale));
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  const ctx = c.getContext("2d"); if (!ctx) throw new Error("캔버스를 만들지 못했습니다");
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, h); ctx.drawImage(img, 0, 0, w, h);
  const blob: Blob = await new Promise((ok, bad) => c.toBlob((b) => (b ? ok(b) : bad(new Error("JPEG 변환 실패"))), "image/jpeg", 0.9));
  return { bytes: new Uint8Array(await blob.arrayBuffer()), w, h };
}

export async function photosToPdf(urls: string[], onProgress?: (done: number, total: number) => void): Promise<Blob> {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const offsets: number[] = [];
  let size = 0;
  const push = (p: Uint8Array | string) => { const b = typeof p === "string" ? enc.encode(p) : p; parts.push(b); size += b.length; };
  const obj = (n: number, body: Array<Uint8Array | string>) => { offsets[n] = size; push(`${n} 0 obj\n`); body.forEach(push); push("\nendobj\n"); };

  push("%PDF-1.4\n%\xFF\xFF\xFF\xFF\n");
  const images: Array<{ bytes: Uint8Array; w: number; h: number }> = [];
  for (let i = 0; i < urls.length; i++) { images.push(await toJpeg(urls[i])); onProgress?.(i + 1, urls.length); }
  // 1 = catalog, 2 = pages, 페이지마다 3개(page, contents, image)
  const pageIds = images.map((_, i) => 3 + i * 3);
  obj(1, ["<< /Type /Catalog /Pages 2 0 R >>"]);
  obj(2, [`<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${images.length} >>`]);
  images.forEach((im, i) => {
    const pid = pageIds[i], cid = pid + 1, iid = pid + 2;
    const pw = 595, ph = Math.round((595 * im.h) / im.w);
    const content = `q ${pw} 0 0 ${ph} 0 0 cm /Im${i} Do Q`;
    obj(pid, [`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pw} ${ph}] /Resources << /XObject << /Im${i} ${iid} 0 R >> >> /Contents ${cid} 0 R >>`]);
    obj(cid, [`<< /Length ${content.length} >>\nstream\n${content}\nendstream`]);
    obj(iid, [`<< /Type /XObject /Subtype /Image /Width ${im.w} /Height ${im.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${im.bytes.length} >>\nstream\n`, im.bytes, "\nendstream"]);
  });
  const total = 3 + images.length * 3;
  const xref = size;
  push(`xref\n0 ${total}\n0000000000 65535 f \n`);
  for (let n = 1; n < total; n++) push(`${String(offsets[n]).padStart(10, "0")} 00000 n \n`);
  push(`trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);
  return new Blob(parts as BlobPart[], { type: "application/pdf" });
}
