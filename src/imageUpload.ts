/**
 * 업로드용 이미지 준비 (모바일 대응).
 *
 * 모바일에서 사진이 안 올라가던 원인들을 한 번에 처리한다.
 *  - iPhone HEIC: createImageBitmap이 못 읽는 기기가 있어 <img> 디코딩으로 한 번 더 시도
 *  - 고화소 사진(48MP 등): 모바일 캔버스 크기 한계를 넘어 빈 이미지가 되므로 총 픽셀 수도 제한
 *  - toDataURL(base64)은 메모리를 크게 먹어 모바일에서 실패 → toBlob 사용
 *  - 전부 실패하면 원본을 "실제 MIME/확장자"로 올린다 (jpeg로 잘못 표기하면 나중에 안 열린다)
 */
export type PreparedImage = { blob: Blob; contentType: string; ext: string };

const MAX_PIXELS = 6_000_000; // 모바일 캔버스 안전선 (약 3000x2000 — iOS 캔버스 한계 4096²의 1/3 아래)

export type PrepareOptions = {
  /** WebP 품질(0~1). JPEG 폴백은 +0.06. 기본 0.80 — 예전 0.72는 복합기 화면·에러코드 글자가 뭉개져 증상 파악이 안 됐다(2026-09-17 AS 접수 사진 피드백) */
  quality?: number;
  /** 이 바이트 이하이고 maxDim 안에 들어오는 JPEG/WebP/PNG 원본은 다시 압축하지 않고 그대로 올린다 — 재압축은 항상 화질을 잃는다 */
  keepOriginalUnderBytes?: number;
};

function extOf(file: File, fallback: string) {
  const fromName = (file.name.split(".").pop() || "").toLowerCase();
  return /^[a-z0-9]{2,5}$/.test(fromName) ? fromName : fallback;
}

async function decode(file: File): Promise<{ source: CanvasImageSource; width: number; height: number } | null> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file);
      if (bitmap.width && bitmap.height) return { source: bitmap, width: bitmap.width, height: bitmap.height };
    } catch { /* HEIC 등 — 아래 <img> 경로로 재시도 */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("이미지 디코딩 실패"));
      element.src = url;
    });
    if (!image.naturalWidth || !image.naturalHeight) return null;
    return { source: image, width: image.naturalWidth, height: image.naturalHeight };
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function prepareImageForUpload(file: File, maxDim = 1600, opts: PrepareOptions = {}): Promise<PreparedImage> {
  const original: PreparedImage = {
    blob: file,
    contentType: file.type || "application/octet-stream",
    ext: extOf(file, "jpg"),
  };
  if (file.type.startsWith("video/")) return original;

  const decoded = await decode(file);
  if (!decoded) return original;   // 디코딩 불가 — 원본 그대로 (형식 표기는 정확히)

  const { source, width, height } = decoded;
  // 작은 원본은 손대지 않는다 — 폰이 이미 압축한 사진을 다시 압축하면 글자가 뭉개진다
  if (opts.keepOriginalUnderBytes && file.size <= opts.keepOriginalUnderBytes && Math.max(width, height) <= maxDim && /^image\/(jpeg|webp|png)$/i.test(file.type)) {
    if (typeof (source as ImageBitmap).close === "function") (source as ImageBitmap).close();
    return original;
  }
  const dimScale = Math.min(1, maxDim / Math.max(width, height));
  const pixelScale = Math.min(1, Math.sqrt(MAX_PIXELS / (width * height)));
  const scale = Math.min(dimScale, pixelScale);
  const targetWidth = Math.max(1, Math.round(width * scale));
  const targetHeight = Math.max(1, Math.round(height * scale));

  try {
    const canvas = document.createElement("canvas");
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const context = canvas.getContext("2d");
    if (!context) return original;
    context.drawImage(source, 0, 0, targetWidth, targetHeight);
    // WebP 우선(같은 화질에서 JPEG보다 30~50% 작다) — 미지원 브라우저는 요청을 무시하고
    // 다른 형식을 돌려주므로 blob.type을 확인해 JPEG로 폴백한다 (스토리지 용량 절감)
    const encode = (type: string, quality: number) => new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
    const quality = Math.min(0.95, Math.max(0.5, opts.quality ?? 0.8));
    let blob = await encode("image/webp", quality);
    let contentType = "image/webp";
    let ext = "webp";
    if (!blob || blob.type !== "image/webp") {
      blob = await encode("image/jpeg", Math.min(0.95, quality + 0.06));
      contentType = "image/jpeg";
      ext = "jpg";
    }
    if (typeof (source as ImageBitmap).close === "function") (source as ImageBitmap).close();
    if (!blob || !blob.size) return original;
    // 이미 최적화된 파일을 다시 압축해 더 커지는 경우엔 원본이 낫다 (열리는 형식일 때만)
    if (blob.size >= file.size && /^image\/(jpeg|webp|png)$/i.test(file.type)) return original;
    return { blob, contentType, ext };
  } catch {
    return original;
  }
}
