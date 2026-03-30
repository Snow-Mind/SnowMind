"use client";

import { type ComponentProps, useEffect, useRef, useState } from "react";
import { ResponsiveContainer } from "recharts";

type ResponsiveContainerProps = ComponentProps<typeof ResponsiveContainer>;

interface SafeResponsiveContainerProps
  extends Omit<ResponsiveContainerProps, "width" | "height"> {
  className?: string;
}

const MIN_RENDER_SIZE = 2;

function toPixelValue(value: number | string | undefined): number | undefined {
  return typeof value === "number" ? value : undefined;
}

export default function SafeResponsiveContainer({
  className = "h-full w-full",
  minWidth,
  minHeight,
  children,
  ...rest
}: SafeResponsiveContainerProps) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const [canRender, setCanRender] = useState(false);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;

    const update = () => {
      const rect = wrapper.getBoundingClientRect();
      const nextWidth = Math.max(0, Math.floor(rect.width));
      const nextHeight = Math.max(0, Math.floor(rect.height));
      setSize({ width: nextWidth, height: nextHeight });
      setCanRender(
        nextWidth >= MIN_RENDER_SIZE && nextHeight >= MIN_RENDER_SIZE,
      );
    };

    update();

    if (typeof ResizeObserver === "undefined") {
      const timeout = window.setTimeout(update, 0);
      return () => window.clearTimeout(timeout);
    }

    const observer = new ResizeObserver(update);
    observer.observe(wrapper);

    return () => {
      observer.disconnect();
    };
  }, []);

  return (
    <div
      ref={wrapperRef}
      className={className}
      style={{
        minWidth: toPixelValue(minWidth),
        minHeight: toPixelValue(minHeight),
      }}
    >
      {canRender ? (
        <ResponsiveContainer
          width={size.width}
          height={size.height}
          minWidth={minWidth}
          minHeight={minHeight}
          {...rest}
        >
          {children}
        </ResponsiveContainer>
      ) : null}
    </div>
  );
}