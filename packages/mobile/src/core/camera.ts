// packages/mobile/src/core/camera.ts
//
// Camera / image contract. The actual expo-camera / expo-image-picker / expo-image-manipulator calls
// are injected (ports) so this stays pure + testable; Phase 3 wiring in `App`/screens provides the
// native implementations. Per security.md + driver flows, captured evidence photos are: resized to a
// bounded dimension, compressed, and **stripped of EXIF/GPS** before they are ever queued (C5.4
// uploads them via a presigned URL; the client must never send location metadata in the image).

import type { CapturedPhoto } from "@/design/components/PhotoCapture";

export interface NativeImage {
  uri: string;
  width: number;
  height: number;
  /** Bytes. */
  size: number;
}

export interface ImageSourcePort {
  /** Launch the camera (or library) and return the raw image. */
  capture(): Promise<NativeImage | null>;
}

export interface ImageProcessorPort {
  /** Resize + compress + strip EXIF, returning a new local file. */
  normalize(img: NativeImage, maxDim: number, quality: number): Promise<NativeImage>;
}

export interface CameraDeps {
  source: ImageSourcePort;
  processor: ImageProcessorPort;
  /** Longest-edge bound in px (driver evidence is small). */
  maxDim?: number;
  quality?: number;
  /** Injectable clock for tests. */
  now?: () => string;
}

const DEFAULT_MAX_DIM = 1600;
const DEFAULT_QUALITY = 0.8;
const MAX_BYTES = 5 * 1024 * 1024; // media.tooLarge

export class Camera {
  constructor(private readonly deps: CameraDeps) {}

  /** Capture + normalize one evidence photo. Returns null when the user cancels. */
  async takePhoto(): Promise<CapturedPhoto | null> {
    const raw = await this.deps.source.capture();
    if (!raw) return null;
    const processed = await this.deps.processor.normalize(
      raw,
      this.deps.maxDim ?? DEFAULT_MAX_DIM,
      this.deps.quality ?? DEFAULT_QUALITY,
    );
    if (processed.size > MAX_BYTES) {
      throw new Error("MEDIA_TOO_LARGE");
    }
    return {
      uri: processed.uri,
      width: processed.width,
      height: processed.height,
      size: processed.size,
      createdAt: this.deps.now ? this.deps.now() : new Date().toISOString(),
    };
  }
}
