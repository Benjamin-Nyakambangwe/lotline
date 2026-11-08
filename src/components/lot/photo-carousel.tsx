"use client";

import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, ImageOff, Images } from "lucide-react";
import Image from "next/image";
import { type ReactNode, useCallback, useRef, useState } from "react";
import type { GalleryItem } from "@/lib/db/schema";
import { cn } from "@/lib/utils";

/** The full-size photo for a listing thumbnail (ABC serves both from the same folder). */
export const zoomOf = (thumb: string | null) =>
  thumb ? thumb.replace(/-Thumb\.(jpe?g|png|webp)$/i, "-Zoom.$1") : null;

/** A lot's photos, fetched only when someone swipes (never part of the catalogue download). */
function usePhotos(lotId: number, enabled: boolean, known?: GalleryItem[]) {
  return useQuery({
    queryKey: ["lot-photos", lotId],
    queryFn: async (): Promise<GalleryItem[]> => {
      const r = await fetch(`/api/lots/${lotId}/photos`);
      return r.ok ? ((await r.json()) as { photos: GalleryItem[] }).photos : [];
    },
    enabled: enabled && !known,
    initialData: known,
    staleTime: 10 * 60_000,
  });
}

function Slide({
  src,
  alt,
  sizes,
  quality,
  fit,
  eager = false,
}: {
  eager?: boolean;
  src: string | null;
  alt: string;
  sizes: string;
  quality: 60 | 75;
  fit: "cover" | "contain";
}) {
  const [failed, setFailed] = useState(false);
  if (!src || failed)
    return (
      <div className="flex size-full items-center justify-center text-muted-foreground">
        <ImageOff className="size-6" aria-hidden="true" />
      </div>
    );
  return (
    <Image
      src={src}
      alt={alt}
      fill
      sizes={sizes}
      quality={quality}
      loading={eager ? "eager" : "lazy"}
      onError={() => setFailed(true)}
      className={fit === "cover" ? "object-cover" : "object-contain"}
    />
  );
}

/**
 * Swipeable photos for a lot: the main photo shows at once, the rest load only when someone
 * swipes or taps an arrow. Native scroll-snap, so it swipes like any phone gallery; arrows
 * appear for mouse users. Tapping a photo calls `onOpen` with its index.
 */
export function PhotoCarousel({
  lotId,
  title,
  first,
  count,
  photos: known,
  sizes,
  onOpen,
  overlay,
  fit = "cover",
  quality = 60,
  eager = false,
  className,
}: {
  /** load the main photo straight away (the first cards on screen) */
  eager?: boolean;
  lotId: number;
  title: string;
  /** the main photo (full size), shown before the gallery loads */
  first: string | null;
  /** how many photos the lot has, if known */
  count: number;
  /** the gallery when the caller already has it */
  photos?: GalleryItem[];
  sizes: string;
  onOpen?: (index: number) => void;
  /** badges laid over the photo (countdown, run, ...) */
  overlay?: ReactNode;
  fit?: "cover" | "contain";
  quality?: 60 | 75;
  className?: string;
}) {
  const track = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const [wanted, setWanted] = useState(false);
  const { data: photos } = usePhotos(lotId, wanted, known);
  const total = photos?.length ? photos.length : Math.max(count, first ? 1 : 0);
  const srcAt = (i: number) =>
    photos?.length ? (photos[i]?.zoom ?? null) : i === 0 ? first : null;

  const onScroll = useCallback(() => {
    const el = track.current;
    if (!el) return;
    if (!wanted) setWanted(true);
    setIndex(Math.round(el.scrollLeft / Math.max(1, el.clientWidth)));
  }, [wanted]);

  const go = (d: number) => {
    const el = track.current;
    if (!el) return;
    setWanted(true);
    const next = Math.min(total - 1, Math.max(0, index + d));
    el.scrollTo({ left: next * el.clientWidth, behavior: "smooth" });
  };

  return (
    <section
      className={cn(
        "group/photos relative overflow-hidden bg-muted",
        className,
      )}
      aria-roledescription="carousel"
      aria-label={`Photos of ${title}`}
    >
      <div
        ref={track}
        onScroll={onScroll}
        className="flex size-full snap-x snap-mandatory overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {Array.from({ length: Math.max(1, total) }, (_, i) => (
          <button
            // Slides are positional: photo i is always slide i.
            // biome-ignore lint/suspicious/noArrayIndexKey: positional slides
            key={i}
            type="button"
            tabIndex={-1}
            onClick={() => onOpen?.(i)}
            aria-label={`${title}, photo ${i + 1} of ${Math.max(1, total)}`}
            className="relative size-full shrink-0 snap-center"
          >
            {i === 0 || photos?.length ? (
              <Slide
                src={srcAt(i)}
                alt=""
                sizes={sizes}
                quality={quality}
                fit={fit}
                eager={eager && i === 0}
              />
            ) : null}
            {i > 0 && !photos?.length && (
              <span className="absolute inset-0 animate-pulse bg-muted" />
            )}
          </button>
        ))}
      </div>

      {overlay}

      {total > 1 && (
        <>
          <span className="pointer-events-none absolute top-2 right-2 flex items-center gap-1 rounded-full bg-black/55 px-2 py-0.5 text-xs font-medium text-white tabular-nums backdrop-blur-sm">
            <Images className="size-3" aria-hidden="true" />
            {index + 1}/{total}
          </span>
          <div className="pointer-events-none absolute inset-x-0 bottom-2 flex justify-center gap-1">
            {Array.from({ length: Math.min(total, 7) }, (_, d) => {
              const active =
                total <= 7
                  ? d === index
                  : d === Math.round((index / (total - 1)) * 6);
              return (
                <span
                  // biome-ignore lint/suspicious/noArrayIndexKey: positional dots
                  key={d}
                  className={cn(
                    "h-1.5 rounded-full bg-white/70 shadow transition-all",
                    active ? "w-4 bg-white" : "w-1.5",
                  )}
                />
              );
            })}
          </div>
          <button
            type="button"
            onClick={() => go(-1)}
            disabled={index === 0}
            aria-label="Previous photo"
            className="absolute top-1/2 left-2 hidden size-8 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 text-white opacity-0 backdrop-blur-sm transition-opacity group-hover/photos:opacity-100 focus-visible:opacity-100 disabled:invisible pointer-fine:flex"
          >
            <ChevronLeft className="size-5" />
          </button>
          <button
            type="button"
            onClick={() => go(1)}
            disabled={index >= total - 1}
            aria-label="Next photo"
            className="absolute top-1/2 right-2 hidden size-8 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 text-white opacity-0 backdrop-blur-sm transition-opacity group-hover/photos:opacity-100 focus-visible:opacity-100 disabled:invisible pointer-fine:flex"
          >
            <ChevronRight className="size-5" />
          </button>
        </>
      )}
    </section>
  );
}
