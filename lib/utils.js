import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Merges conditional Tailwind CSS class names into a single string.
 * @param {...string} inputs - The class names to be merged.
 * @returns {string} A merged Tailwind CSS class string.
 */
export function cn(...inputs) {
  return twMerge(clsx(inputs));
}