/** @file Blank slate HTML for empty home page state.
 *
 * Renders a centered message when there are no albums. Admin users see an
 * "Upload album" CTA that opens the upload dialog; non-admin users see
 * "Nothing here yet. Check back later."
 *
 * Styles are inlined so they are only sent when the blank slate is shown.
 */

const BLANK_SLATE_STYLES = `
.blank-slate {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1rem;
  padding: 3rem 1.5rem;
  min-height: 12rem;
  text-align: center;
}
.blank-slate-icon {
  color: rgba(255, 255, 255, 0.4);
  width: 4rem;
  height: 4rem;
}
.blank-slate-icon musical-note-icon {
  display: block;
  width: 100%;
  height: 100%;
}
.blank-slate-headline {
  font-size: var(--text-xl, 1.25rem);
  font-weight: 600;
  margin: 0;
  color: rgba(255, 255, 255, 0.9);
}
.blank-slate-description {
  font-size: var(--text-base, 1rem);
  margin: 0;
  color: rgba(255, 255, 255, 0.6);
}
.blank-slate-cta {
  margin-top: 0.5rem;
  padding: 0.625rem 1.5rem;
  background: var(--color-blue-500, #3b82f6);
  color: #fff;
  border: none;
  border-radius: 0.5rem;
  cursor: pointer;
  font-family: inherit;
  font-size: 1rem;
  font-weight: 500;
  transition: background var(--default-transition-duration, 150ms) var(--default-transition-timing-function, cubic-bezier(0.4, 0, 0.2, 1)),
    transform var(--default-transition-duration, 150ms) var(--default-transition-timing-function, cubic-bezier(0.4, 0, 0.2, 1));
}
.blank-slate-cta:hover {
  background: color-mix(in oklch, var(--color-blue-500, #3b82f6) 85%, white);
}
.blank-slate-cta:active {
  transform: scale(0.98);
}
.blank-slate-cta:focus {
  outline: none;
}
.blank-slate-cta:focus-visible {
  outline: 2px solid currentColor;
  outline-offset: 2px;
}
`;

/**
 * Escape HTML special characters to prevent XSS
 */
function escapeHtml(unsafe: string): string {
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/** Props for blank slate HTML */
export interface BlankSlateProps {
  /** When true, show "Upload album" CTA; when false, show non-admin copy only */
  isAdmin: boolean;
}

/**
 * Generate HTML for the blank slate (empty state) on the home page.
 *
 * @param props - Blank slate options; isAdmin controls headline, description, and CTA
 * @returns HTML string for a section with icon, headline, description, and optional CTA
 *
 * @example
 * ```ts
 * const html = blankSlateHtml({ isAdmin: true });
 * // Renders: icon, "No albums yet", "Upload your first album...", "Upload album" button
 *
 * const html = blankSlateHtml({ isAdmin: false });
 * // Renders: icon, "Nothing here yet", "Check back later.", no button
 * ```
 */
export default function blankSlateHtml(props: BlankSlateProps): string {
  const { isAdmin } = props;

  const headline = isAdmin ? "No albums yet" : "Nothing here yet.";
  const description = isAdmin
    ? "Upload your first album to get started."
    : "Check back later.";

  const escapedHeadline = escapeHtml(headline);
  const escapedDescription = escapeHtml(description);

  const ctaHtml = isAdmin
    ? `<button type="button" id="blank-slate-upload" class="blank-slate-cta" onclick="document.dispatchEvent(new CustomEvent('upload-dialog-open'))">Upload album</button>`
    : "";

  return `<style>${BLANK_SLATE_STYLES}</style>
<section class="blank-slate" role="status" aria-live="polite">
  <div class="blank-slate-icon" aria-hidden="true">
    <musical-note-icon></musical-note-icon>
  </div>
  <h2 class="blank-slate-headline">${escapedHeadline}</h2>
  <p class="blank-slate-description">${escapedDescription}</p>
  ${ctaHtml}
</section>`;
}
