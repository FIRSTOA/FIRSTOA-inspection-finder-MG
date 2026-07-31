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

const MAX_PIXELS = 4_000_000; // 모바일 캔버스 안전선 (약 2400x1600)

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

export async function prepareImageForUpload(file: File, maxDim = 1600): Promise<PreparedImage> {
  const original: PreparedImage = {
    blob: file,
    contentType: file.type || "application/octet-stream",
    ext: extOf(file, "jpg"),
  };
  if (file.type.startsWith("video/")) return original;

  const decoded = await decode(file);
  if (!decoded) return original;   // 디코딩 불가 — 원본 그대로 (형식 표기는 정확히)

  const { source, width, height } = decoded;
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
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
    if (typeof (source as ImageBitmap).close === "function") (source as ImageBitmap).close();
    if (!blob || !blob.size) return original;
    return { blob, contentType: "image/jpeg", ext: "jpg" };
  } catch {
    return original;
  }
}
