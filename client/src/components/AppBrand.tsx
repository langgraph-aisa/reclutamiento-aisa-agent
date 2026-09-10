import { cn } from "@/lib/utils";
import type { ImgHTMLAttributes } from "react";

type AppBrandProps = Omit<ImgHTMLAttributes<HTMLImageElement>, "src">;

export function AppBrand({ className, alt = "AISA", ...props }: AppBrandProps) {
  return (
    <img
      src="/brand/aisa-logo.png"
      alt={alt}
      width={250}
      height={89}
      decoding="async"
      className={cn(
        "h-9 w-auto object-contain dark:brightness-0 dark:invert",
        className
      )}
      {...props}
    />
  );
}
